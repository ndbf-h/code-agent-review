import { beforeEach, describe, expect, it, vi } from 'vitest'

// createAgentsForTask 读取 LLM_MODEL，提供最小可用配置
process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/test'
process.env.RABBITMQ_URL = 'amqp://localhost:5672'
process.env.LLM_API_KEY = 'test-key'

vi.mock('../../db/queries', () => ({
  insertTask: vi.fn(async () => true),
  insertAgent: vi.fn(async () => undefined),
  linkCodeVersionToReview: vi.fn(async () => undefined),
  markTaskFailed: vi.fn(async () => undefined),
  updateTaskStatus: vi.fn(),
  getTask: vi.fn(),
  insertReport: vi.fn(),
  getReportByTask: vi.fn(),
  getMessagesByTask: vi.fn(),
  getAgentsByTask: vi.fn()
}))
vi.mock('../eventService', () => ({
  appendTaskEvent: vi.fn(async () => 1)
}))

import * as queries from '../../db/queries'
import * as eventService from '../eventService'
import { submitReviewTask } from '../taskService'
import { DuplicateTaskError, QueueUnavailableError } from '../../errors'

/** 记录跨模块调用顺序，验证提交流程的步骤与先后 */
function trackCalls(): string[] {
  const calls: string[] = []
  vi.mocked(queries.insertTask).mockImplementation(async () => {
    calls.push('insertTask')
    return true
  })
  vi.mocked(queries.insertAgent).mockImplementation(async agent => {
    calls.push(`insertAgent:${agent.role}`)
  })
  vi.mocked(queries.linkCodeVersionToReview).mockImplementation(async () => {
    calls.push('linkCodeVersion')
  })
  vi.mocked(eventService.appendTaskEvent).mockImplementation(async (_id, event) => {
    calls.push(`event:${event.type}`)
    return 1
  })
  return calls
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('submitReviewTask', () => {
  it('按顺序创建任务、五个 agents、task_queued 事件，最后入队', async () => {
    const calls = trackCalls()
    const publish = vi.fn(async () => {
      calls.push('publish')
    })

    const task = await submitReviewTask({ code: 'const a = 1', language: 'javascript' }, publish)

    expect(calls).toEqual([
      'insertTask',
      'insertAgent:orchestrator',
      'insertAgent:security',
      'insertAgent:performance',
      'insertAgent:style',
      'insertAgent:logic',
      'event:task_queued',
      'publish'
    ])
    expect(publish).toHaveBeenCalledWith(task.id)
    expect(task.status).toBe('pending')
    expect(task.scopeId).toBe(task.id)
    // 未提供可选字段时不写入，避免 JSON 中出现 null
    expect(task).not.toHaveProperty('reviewConfig')
    expect(task).not.toHaveProperty('source')
  })

  it('agents 的 id 与 orchestrator 使用的 `${role}-${taskId}` 一致（messages 外键依赖它）', async () => {
    trackCalls()
    const task = await submitReviewTask(
      { code: 'x', language: 'go' },
      vi.fn(async () => undefined)
    )
    const agentIds = vi.mocked(queries.insertAgent).mock.calls.map(([agent]) => agent.id)
    expect(agentIds).toContain(`security-${task.id}`)
    expect(agentIds).toContain(`orchestrator-${task.id}`)
  })

  it('携带 sourceVersionId 时在入队前关联代码版本，且不写入任务本身', async () => {
    const calls = trackCalls()
    const task = await submitReviewTask(
      { code: 'x', language: 'go', sourceVersionId: 'v-1' },
      vi.fn(async () => undefined)
    )
    expect(queries.linkCodeVersionToReview).toHaveBeenCalledWith('v-1', task.id)
    expect(calls.indexOf('linkCodeVersion')).toBeLessThan(calls.indexOf('event:task_queued'))
    expect(task).not.toHaveProperty('sourceVersionId')
  })

  it('reviewConfig 与 source 随任务落库', async () => {
    trackCalls()
    const source = { provider: 'github' as const, repo: 'r/p', prNumber: 3, headSha: 'abc' }
    const reviewConfig = { severityThreshold: 'warning' as const }
    await submitReviewTask(
      { code: 'x', language: 'go', title: 'PR #3', reviewConfig, source },
      vi.fn(async () => undefined)
    )
    expect(queries.insertTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'PR #3', reviewConfig, source }),
      undefined
    )
  })

  it('入队失败时标记任务失败、写 error 事件并抛出 QueueUnavailableError', async () => {
    const calls = trackCalls()
    const publish = vi.fn(async () => {
      throw new Error('broker down')
    })

    await expect(submitReviewTask({ code: 'x', language: 'go' }, publish)).rejects.toBeInstanceOf(
      QueueUnavailableError
    )

    expect(queries.markTaskFailed).toHaveBeenCalledTimes(1)
    expect(calls).toContain('event:error')
  })

  it('入队失败且写 error 事件也失败时，仍抛出 QueueUnavailableError', async () => {
    trackCalls()
    vi.mocked(eventService.appendTaskEvent).mockImplementation(async (_id, event) => {
      if (event.type === 'error') throw new Error('db down')
      return 1
    })

    await expect(
      submitReviewTask(
        { code: 'x', language: 'go' },
        vi.fn(async () => {
          throw new Error('broker down')
        })
      )
    ).rejects.toBeInstanceOf(QueueUnavailableError)
  })

  it('dedupeKey 传给 insertTask；冲突时抛出 DuplicateTaskError 且不建 agents、不写事件、不入队', async () => {
    const calls = trackCalls()
    vi.mocked(queries.insertTask).mockImplementation(async () => {
      calls.push('insertTask')
      return false
    })
    const publish = vi.fn(async () => undefined)

    await expect(
      submitReviewTask({ code: 'x', language: 'go', dedupeKey: 'github:r/p#1@abc' }, publish)
    ).rejects.toBeInstanceOf(DuplicateTaskError)

    expect(queries.insertTask).toHaveBeenCalledWith(expect.any(Object), 'github:r/p#1@abc')
    expect(calls).toEqual(['insertTask'])
    expect(publish).not.toHaveBeenCalled()
  })

  it('queueNotice 追加到 task_queued 事件，且不写入任务本身', async () => {
    trackCalls()
    const task = await submitReviewTask(
      { code: 'x', language: 'go', queueNotice: '以下文件未纳入审查：a.ts（总量超限）' },
      vi.fn(async () => undefined)
    )
    expect(eventService.appendTaskEvent).toHaveBeenCalledWith(task.id, {
      type: 'task_queued',
      message: '任务已创建，进入审查队列。以下文件未纳入审查：a.ts（总量超限）'
    })
    expect(task).not.toHaveProperty('queueNotice')
  })
})
