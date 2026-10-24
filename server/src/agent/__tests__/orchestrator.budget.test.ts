import { beforeAll, describe, expect, it, vi } from 'vitest'

// 预算相关配置必须在 loadConfig 之前就位
process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/test'
process.env.RABBITMQ_URL = 'amqp://localhost:5672'
process.env.LLM_API_KEY = 'test-key'
process.env.TASK_TOKEN_BUDGET = '1'

const mocks = vi.hoisted(() => {
  /** 每次 LLM 调用记一笔 token 用量的模式（用于验证中途耗尽） */
  const state = { meter: false, tokensPerCall: 0, llmCalls: 0, structuredCalls: 0 }
  async function meter() {
    state.llmCalls += 1
    if (state.meter) {
      const { recordLlmUsage } = await import('../../observability/tracing')
      recordLlmUsage({ model: 'fake', promptTokens: state.tokensPerCall, completionTokens: 0 })
    }
  }
  const fakeClient = {
    async *chatStream() {
      await meter()
      yield { type: 'text', content: '分析完成' }
      yield { type: 'done' }
    },
    async chatWithRetry() {
      await meter()
      return { content: '分析完成', finishReason: 'stop', toolCalls: [] }
    },
    async chatStructured() {
      state.structuredCalls += 1
      return { issues: [], score: 88 }
    }
  }
  return { fakeClient, state }
})

vi.mock('../llm-client', async importOriginal => {
  const actual = await importOriginal<typeof import('../llm-client')>()
  return {
    ...actual,
    llmClient: mocks.fakeClient as unknown as typeof actual.llmClient
  }
})

vi.mock('../role-router', () => ({
  getClientForRole: () => mocks.fakeClient
}))

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
      const report = await runReviewTask({
        taskId: 'task-budget',
        code: 'const a = 1',
        language: 'javascript',
        onEvent: event => {
          events.push(event.type)
        }
      })

      expect(report.governance?.budgetExceeded).toBe(true)
      expect(report.governance?.budgetExceededAt?.stage).toBe('start')
      expect(Object.values(report.reviewStatus ?? {})).toEqual([
        'fallback',
        'fallback',
        'fallback',
        'fallback'
      ])
      expect(events).toContain('agent_thought')
    })
  })

  it('reviewer 运行中耗尽预算：停止 ReAct、跳过结构化输出、记录耗尽位置', async () => {
    mocks.state.meter = true
    mocks.state.tokensPerCall = 5
    mocks.state.llmCalls = 0
    mocks.state.structuredCalls = 0
    try {
      await withTaskTrace({ taskId: 'task-budget-mid', attempt: 1 }, async () => {
        const report = await runReviewTask({
          taskId: 'task-budget-mid',
          code: 'const a = 1',
          language: 'javascript',
          onEvent: () => {}
        })

        expect(report.governance?.budgetExceeded).toBe(true)
        expect(report.governance?.budgetExceededAt).toBeDefined()
        // 首次 LLM 调用记账 5 token 后预算（1）即耗尽：其后不再有结构化输出调用
        expect(mocks.state.structuredCalls).toBe(0)
        // 只有耗尽前已发起的调用（规划阶段 + 至多每个并行 reviewer 一次在途调用）
        expect(mocks.state.llmCalls).toBeLessThanOrEqual(1 + 4)
      })
    } finally {
      mocks.state.meter = false
    }
  })
})
