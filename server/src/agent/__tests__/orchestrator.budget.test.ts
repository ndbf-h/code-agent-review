import { beforeAll, describe, expect, it, vi } from 'vitest'

// 预算相关配置必须在 loadConfig 之前就位
process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/test'
process.env.RABBITMQ_URL = 'amqp://localhost:5672'
process.env.LLM_API_KEY = 'test-key'
process.env.TASK_TOKEN_BUDGET = '1'

const mocks = vi.hoisted(() => {
  const fakeClient = {
    async *chatStream() {
      yield { type: 'text', content: '分析完成' }
      yield { type: 'done' }
    },
    async chatWithRetry() {
      return { content: '分析完成', finishReason: 'stop', toolCalls: [] }
    },
    async chatStructured() {
      return { issues: [], score: 88 }
    }
  }
  return { fakeClient }
})

vi.mock('../llm-client', async importOriginal => {
  const actual = await importOriginal<typeof import('../llm-client')>()
  return {
    ...actual,
    llmClient: mocks.fakeClient as unknown as typeof actual.llmClient
  }
})

import { runReviewTask } from '../orchestrator'
import { loadConfig } from '../../config'
import { recordLlmUsage, withTaskTrace } from '../../observability/tracing'

beforeAll(() => {
  loadConfig()
})

describe('runReviewTask token 预算（REQ-11）', () => {
  it('预算耗尽后 reviewer 直接走规则引擎并标记 budgetExceeded', async () => {
    await withTaskTrace({ taskId: 'task-budget', attempt: 1 }, async () => {
      // 先记一笔用量，让 1 token 的预算立即耗尽
      recordLlmUsage({ model: 'fake', promptTokens: 10, completionTokens: 0 })

      const events: string[] = []
      const report = await runReviewTask('task-budget', 'const a = 1', 'javascript', event => {
        events.push(event.type)
      })

      expect(report.governance?.budgetExceeded).toBe(true)
      expect(Object.values(report.reviewStatus ?? {})).toEqual([
        'fallback',
        'fallback',
        'fallback',
        'fallback'
      ])
      expect(events).toContain('agent_thought')
    })
  })
})
