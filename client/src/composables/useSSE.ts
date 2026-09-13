import { useReviewStore } from '../stores/review'
import type { AgentRole, ReviewReport, TaskStatus } from '../types/index'

const MAX_RECONNECT_ATTEMPTS = 8
const RECONNECT_BASE_DELAY_MS = 2_000
const RECONNECT_MAX_DELAY_MS = 30_000

function getApiBase(): string {
  return import.meta.env.VITE_API_BASE || 'http://localhost:3001/api'
}

function normalizeReport(data: Record<string, unknown>): ReviewReport {
  return {
    issues: ((data.issues || []) as Array<Record<string, unknown>>).map(i => ({
      line: i.line as number,
      severity: i.severity as 'critical' | 'warning' | 'suggestion',
      category: i.category as string,
      message: i.message as string,
      suggestion: i.suggestion as string
    })),
    score: (data.score as number) || 0,
    agentResults: (data.agentResults as Record<string, { issues: Array<{ line: number; severity: 'critical' | 'warning' | 'suggestion'; category: string; message: string; suggestion: string }>; score: number }>) || {}
  }
}

export function useSSE() {
  const store = useReviewStore()
  let eventSource: EventSource | null = null
  let reconnectAttempts = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  // 已消费的最大事件序号：跨重连保留，配合 ?after= 实现断线续传，并丢弃回放期间重复推送的事件
  let currentTaskId: string | null = null
  let lastSeq = 0

  function scheduleReconnect(taskId: string) {
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts, RECONNECT_MAX_DELAY_MS)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect(taskId)
    }, delay)
  }

  /** 重连耗尽后同步任务真实状态，避免在任务仍在后台运行时误报失败 */
  async function syncTaskState(taskId: string) {
    try {
      const res = await fetch(`${getApiBase()}/tasks/${taskId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const detail = await res.json() as {
        task?: { status?: string }
        report?: { content?: Record<string, unknown> } | null
      }
      const taskStatus = detail.task?.status

      if (taskStatus === 'completed' && detail.report?.content) {
        store.setStatus('completed')
        store.loading = false
        store.addMessage({
          role: 'system',
          content: 'Review completed',
          type: 'report',
          report: normalizeReport(detail.report.content)
        })
        return
      }
      if (taskStatus === 'failed') {
        store.setStatus('failed')
        store.loading = false
        store.addMessage({
          role: 'system',
          content: '错误：审查任务已失败',
          type: 'agent_thought'
        })
        return
      }
      if (taskStatus === 'cancelled') {
        store.setStatus('cancelled')
        store.loading = false
        store.addMessage({
          role: 'system',
          content: '任务已被取消',
          type: 'agent_thought'
        })
        return
      }

      // 任务仍在后台运行：如实告知并保留重试入口
      store.loading = false
      store.addMessage({
        role: 'system',
        content: '错误：SSE 连接丢失，任务仍在后台运行，请点击重试重新连接',
        type: 'agent_thought'
      })
    } catch {
      store.loading = false
      store.setStatus('failed')
      store.addMessage({
        role: 'system',
        content: '错误：SSE 连接丢失，请检查网络后重试',
        type: 'agent_thought'
      })
    }
  }

  function connect(taskId: string) {
    // 换了新任务则重置续传位点；同一任务手动重连时带上 ?after= 从断点续传
    if (currentTaskId !== taskId) {
      currentTaskId = taskId
      lastSeq = 0
    }
    const url = lastSeq > 0
      ? `${getApiBase()}/tasks/${taskId}/stream?after=${lastSeq}`
      : `${getApiBase()}/tasks/${taskId}/stream`
    eventSource = new EventSource(url)

    eventSource.onopen = () => {
      reconnectAttempts = 0
    }

    const handlers: Record<string, (data: Record<string, unknown>) => void> = {
      // 连接快照：任务可能尚在队列中排队（pending），据此渲染排队态
      task_state: (data) => {
        const status = data.status as TaskStatus | undefined
        if (!status) return
        store.setStatus(status)
        if (status === 'completed' || status === 'failed') {
          store.loading = false
        }
      },

      task_queued: (data) => {
        store.setStatus('pending')
        store.addMessage({
          role: 'system',
          content: (data.message as string) || '任务已进入审查队列，等待空闲执行位...',
          type: 'agent_thought'
        })
      },

      task_cancelled: (data) => {
        store.setStatus('cancelled')
        store.loading = false
        store.addMessage({
          role: 'system',
          content: (data.message as string) || '任务已被取消',
          type: 'agent_thought'
        })
      },

      task_retrying: (data) => {
        store.setStatus('pending')
        store.addMessage({
          role: 'system',
          content: (data.message as string) || '任务即将重试...',
          type: 'agent_thought'
        })
      },

      orchestrator_start: (data) => {
        store.setStatus('orchestrating')
        store.addMessage({
          role: 'orchestrator',
          content: (data.message as string) || '开始分析代码...',
          type: 'agent_thought'
        })
      },

      agent_start: (data) => {
        store.setStatus('reviewing')
        const role = (data.role as AgentRole) || 'security'
        store.upsertAgentSlot(role, {
          status: 'working',
          latestMessage: (data.message as string) || '开始审查...'
        })
      },

      agent_thought: (data) => {
        const role = (data.role as AgentRole) || 'security'
        store.upsertAgentSlot(role, {
          latestMessage: (data.message as string) || '思考中...'
        })
      },

      thinking_token: (data) => {
        const role = (data.role as AgentRole) || 'security'
        const token = (data.message as string) || ''
        store.appendToken(role, token)
      },

      tool_call: (data) => {
        const role = (data.role as AgentRole) || 'security'
        store.upsertAgentSlot(role, {
          latestMessage: `工具：${data.toolName || '...'}`
        })
      },

      agent_done: (data) => {
        const role = (data.role as AgentRole) || 'security'
        store.upsertAgentSlot(role, {
          status: 'done',
          latestMessage: (data.message as string) || '审查完成'
        })
      },

      orchestrator_summary: () => {
        store.setStatus('summarizing')
      },

      report_ready: (data) => {
        store.setStatus('completed')
        const report = data.report as Record<string, unknown> | undefined
        if (report) {
          store.addMessage({
            role: 'system',
            content: 'Review completed',
            type: 'report',
            report: normalizeReport(report)
          })
        }
      },

      task_completed: () => {
        store.setStatus('completed')
        store.loading = false
      },

      error: (data) => {
        if (!data || typeof data !== 'object') return
        const agentId = data.agentId as string | undefined
        const message = (data.message as string) || '未知错误'
        if (agentId) {
          const role = (data.role as AgentRole) || 'security'
          store.upsertAgentSlot(role, { status: 'error', latestMessage: message })
        } else {
          store.addMessage({
            role: 'system',
            content: `错误：${message}`,
            type: 'agent_thought'
          })
          store.setStatus('failed')
          store.loading = false
        }
      }
    }

    Object.keys(handlers).forEach(eventType => {
      eventSource!.addEventListener(eventType, (event: MessageEvent) => {
        // 服务端为每帧写入 id: <seq>；回放与实时推送可能重叠送达同一事件，按 seq 去重
        const seq = parseInt(event.lastEventId, 10)
        if (Number.isFinite(seq) && seq > 0) {
          if (seq <= lastSeq) return
          lastSeq = seq
        }
        try {
          const data = JSON.parse(event.data)
          handlers[eventType](data)
        } catch {
          handlers[eventType](event.data)
        }
      })
    })

    eventSource.onerror = () => {
      // 任务已完成或已失败 → 正常结束，不重连也不覆盖状态
      if (store.status === 'completed' || store.status === 'failed') {
        eventSource?.close()
        return
      }

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++
        eventSource?.close()
        scheduleReconnect(taskId)
        return
      }

      // 重连次数耗尽：向服务端确认任务真实状态
      eventSource?.close()
      void syncTaskState(taskId)
    }
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    eventSource?.close()
    eventSource = null
  }

  function retrySSE(id: string) {
    disconnect()
    reconnectAttempts = 0
    store.loading = true
    connect(id)
  }

  return { connect, disconnect, retrySSE }
}
