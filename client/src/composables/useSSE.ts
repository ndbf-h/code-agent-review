import { useReviewStore } from '../stores/review'
import type { ChatMessage } from '../types/index'

export function useSSE() {
  const store = useReviewStore()
  let eventSource: EventSource | null = null

  function connect(taskId: string) {
    const url = `http://localhost:3001/api/tasks/${taskId}/stream`
    eventSource = new EventSource(url)

    const handlers: Record<string, (data: Record<string, unknown>) => void> = {
      orchestrator_start: (data) => {
        store.setStatus('orchestrating')
        store.addMessage({
          role: 'orchestrator',
          content: (data.message as string) || 'Starting review...',
          type: 'agent_thought'
        })
      },

      agent_start: (data) => {
        store.setStatus('reviewing')
        store.addMessage({
          role: (data.role as ChatMessage['role']) || 'system',
          content: (data.message as string) || 'Started reviewing...',
          type: 'agent_thought'
        })
      },

      agent_thought: (data) => {
        store.addMessage({
          role: (data.role as ChatMessage['role']) || 'system',
          content: (data.message as string) || 'Thinking...',
          type: 'agent_thought'
        })
      },

      tool_call: (data) => {
        store.addMessage({
          role: (data.role as ChatMessage['role']) || 'system',
          content: `Calling ${data.toolName}...`,
          type: 'tool_call',
          toolName: data.toolName as string
        })
      },

      agent_done: (data) => {
        store.addMessage({
          role: (data.role as ChatMessage['role']) || 'system',
          content: (data.message as string) || 'Review completed',
          type: 'final_answer'
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
              agentResults: (report.agentResults as Record<string, { issues: Array<Record<string, unknown>>; score: number }>) || {}
            }
          })
        }
      },

      task_completed: () => {
        store.setStatus('completed')
        store.loading = false
      },

      error: (data) => {
        store.addMessage({
          role: 'system',
          content: `Error: ${data.message || 'Unknown error'}`,
          type: 'agent_thought'
        })
        store.setStatus('failed')
        store.loading = false
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
      store.loading = false
      store.setStatus('failed')
      eventSource?.close()
    }
  }

  function disconnect() {
    eventSource?.close()
    eventSource = null
  }

  return { connect, disconnect }
}
