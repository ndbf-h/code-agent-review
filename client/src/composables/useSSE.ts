import { useReviewStore } from '../stores/review'
import type { ChatMessage, AgentRole } from '../types/index'

export function useSSE() {
  const store = useReviewStore()
  let eventSource: EventSource | null = null
  let reconnectAttempted = false

  function connect(taskId: string) {
    const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api'
    const url = `${API_BASE}/tasks/${taskId}/stream`
    eventSource = new EventSource(url)

    const handlers: Record<string, (data: Record<string, unknown>) => void> = {
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

      report_ready: (data) => {
        store.setStatus('completed')
        const report = data.report as Record<string, unknown>
        if (report) {
          store.addMessage({
            role: 'system',
            content: 'Review completed',
            type: 'report',
            report: {
              issues: ((report.issues || []) as Array<Record<string, unknown>>).map(i => ({
                line: i.line as number,
                severity: i.severity as 'critical' | 'warning' | 'suggestion',
                category: i.category as string,
                message: i.message as string,
                suggestion: i.suggestion as string
              })),
              score: (report.score as number) || 0,
              agentResults: (report.agentResults as Record<string, { issues: Array<{ line: number; severity: 'critical' | 'warning' | 'suggestion'; category: string; message: string; suggestion: string }>; score: number }>) || {}
            }
          })
        }
      },

      task_completed: () => {
        store.setStatus('completed')
        store.loading = false
      },

      error: (data) => {
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
        try {
          const data = JSON.parse(event.data)
          handlers[eventType](data)
        } catch {
          handlers[eventType](event.data)
        }
      })
    })

    eventSource.onerror = () => {
      if (!reconnectAttempted) {
        reconnectAttempted = true
        eventSource?.close()
        setTimeout(() => {
          connect(taskId)
        }, 2000)
        return
      }
      store.loading = false
      store.setStatus('failed')
      store.addMessage({
        role: 'system',
        content: '错误：SSE 连接丢失，请检查网络后重试',
        type: 'agent_thought'
      })
      eventSource?.close()
    }
  }

  function disconnect() {
    eventSource?.close()
    eventSource = null
  }

  function retrySSE(id: string) {
    disconnect()
    reconnectAttempted = false
    store.loading = true
    connect(id)
  }

  return { connect, disconnect, retrySSE }
}
