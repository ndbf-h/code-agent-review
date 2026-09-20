import { describe, expect, it } from 'vitest'
import { TaskBudget } from '../budget'
import { recordLlmUsage, withTaskTrace } from '../../observability/tracing'

describe('TaskBudget（REQ-11）', () => {
  it('预算 <= 0 表示不限制', () => {
    const budget = new TaskBudget(0)
    expect(budget.limit).toBe(0)
    expect(budget.isExceeded()).toBe(false)
  })

  it('无任务上下文时用量为 0，不误判超限', () => {
    const budget = new TaskBudget(100)
    expect(budget.used()).toBe(0)
    expect(budget.isExceeded()).toBe(false)
  })

  it('任务上下文内累计用量达到上限即判定超限', async () => {
    const budget = new TaskBudget(100)

    await withTaskTrace({ taskId: 'budget-task', attempt: 1 }, async () => {
      expect(budget.isExceeded()).toBe(false)

      recordLlmUsage({ model: 'fake', promptTokens: 40, completionTokens: 10 })
      expect(budget.used()).toBe(50)
      expect(budget.isExceeded()).toBe(false)

      recordLlmUsage({ model: 'fake', promptTokens: 40, completionTokens: 20 })
      expect(budget.used()).toBe(110)
      expect(budget.isExceeded()).toBe(true)
    })
  })
})
