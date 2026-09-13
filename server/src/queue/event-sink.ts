import type { ReviewEvent } from '../agent/orchestrator'
import { appendTaskEvent } from '../services/eventService'

const TOKEN_BATCH_WINDOW_MS = 300

export interface TaskEventSink {
  push(event: ReviewEvent): void
  /** 把缓冲中的 token 落库并等待所有在途写入完成（保证此后的写入顺序在其之后） */
  flush(): Promise<void>
  /** 任务结束时冲刷缓冲并停止接收 */
  close(): Promise<void>
}

/**
 * 任务事件落库汇聚点，解决两个问题：
 *
 * 1. 串行化 —— orchestrator 的 onEvent 是同步回调，而落库是异步 INSERT，
 *    并发提交会让自增 seq 与事件的真实顺序错乱（同一 agent 的思考片段乱序）。
 *    用 promise 链保证严格按 push 顺序提交。
 *
 * 2. token 合并 —— thinking_token 是 LLM 流式增量（一次审查可达上千条），
 *    逐条写库会造成写入放大 + NOTIFY 风暴。按 agent 缓冲、窗口内拼接为
 *    一条 thinking_token 事件（message 为拼接后的文本），事件量降两个数量级。
 *    非token事件入队前先冲刷缓冲，保证它排在之前产生的 token 之后。
 */
export function createTaskEventSink(taskId: string, windowMs = TOKEN_BATCH_WINDOW_MS): TaskEventSink {
  const tokenBuffer = new Map<string, { agentId?: string; role: string; text: string }>()
  let flushTimer: NodeJS.Timeout | null = null
  let chain: Promise<void> = Promise.resolve()
  let closed = false

  function enqueue(step: () => Promise<void>): void {
    chain = chain.then(step).catch(error => {
      // 事件落库失败只损失可观测性，不应中断审查本身
      console.error(`[event-sink] 事件落库失败 (task=${taskId}):`, error instanceof Error ? error.message : error)
    })
  }

  async function flushTokens(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    if (tokenBuffer.size === 0) return
    const buffered = [...tokenBuffer.entries()]
    tokenBuffer.clear()
    for (const [key, entry] of buffered) {
      await appendTaskEvent(taskId, {
        type: 'thinking_token',
        agentId: entry.agentId,
        role: entry.role,
        message: entry.text
      })
    }
  }

  return {
    push(event: ReviewEvent): void {
      if (closed) return
      if (event.type === 'thinking_token') {
        const key = event.role || event.agentId || 'unknown'
        const existing = tokenBuffer.get(key)
        if (existing) {
          existing.text += event.message || ''
        } else {
          tokenBuffer.set(key, {
            agentId: event.agentId,
            role: event.role || key,
            text: event.message || ''
          })
        }
        if (!flushTimer) {
          flushTimer = setTimeout(() => {
            flushTimer = null
            enqueue(() => flushTokens())
          }, windowMs)
          flushTimer.unref?.()
        }
        return
      }
      enqueue(async () => {
        await flushTokens()
        await appendTaskEvent(taskId, event)
      })
    },
    flush(): Promise<void> {
      enqueue(() => flushTokens())
      return chain
    },
    close(): Promise<void> {
      closed = true
      enqueue(() => flushTokens())
      return chain
    }
  }
}
