import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../../config'
import type { TaskProducer } from '../producer'
import type { ReportContent, Task } from '../../../../shared/types'

process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/test'
process.env.RABBITMQ_URL = 'amqp://localhost:5672'
process.env.LLM_API_KEY = 'test-key'

const calls: string[] = []

vi.mock('../../db/queries', () => ({
  claimTaskForRun: vi.fn(),
  completeTask: vi.fn(),
  getTask: vi.fn(),
  scheduleTaskRetry: vi.fn(),
  markTaskFailed: vi.fn(),
  resetTaskArtifacts: vi.fn(),
  touchTaskHeartbeat: vi.fn(),
  updateTaskStatus: vi.fn(async () => {
    calls.push('updateTaskStatus')
  }),
  insertTaskMetric: vi.fn(async () => undefined),
  getReviewCache: vi.fn(),
  saveReviewCache: vi.fn(),
  bumpReviewCacheHit: vi.fn(async () => undefined)
}))
vi.mock('../../services/taskService', () => ({
  saveReport: vi.fn(async () => {
    calls.push('saveReport')
  })
}))
vi.mock('../../services/eventService', () => ({
  appendTaskEvent: vi.fn(async () => 1)
}))
vi.mock('../../integrations/github/webhook', () => ({
  commentReportToPullRequest: vi.fn(async () => {
    calls.push('comment')
  })
}))
vi.mock('../../agent/orchestrator', () => ({ runReviewTask: vi.fn() }))
vi.mock('../../agent/llm-client', () => ({ llmClient: { modelName: 'fake-model' } }))
vi.mock('../../observability/tracing', () => ({
  withTaskTrace: async (_ctx: unknown, fn: () => Promise<unknown>) => ({
    result: await fn(),
    usage: { promptTokens: 0, completionTokens: 0, llmCalls: 0, durationMs: 1 }
  })
}))

import * as queries from '../../db/queries'
import * as taskService from '../../services/taskService'
import { commentReportToPullRequest } from '../../integrations/github/webhook'
import { runReviewTask } from '../../agent/orchestrator'
import { runClaimedTask } from '../consumer'

/** 正常执行路径只用到心跳间隔与重试参数 */
const normalRunConfig = {
  heartbeat: { intervalMs: 60_000 },
  taskRetry: { maxAttempts: 1, delayMs: 1000 }
} as unknown as AppConfig

const SECRET = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'

const task: Task = {
  id: 'task-1',
  title: 'PR #1',
  codeSnippet: 'const a = 1',
  language: 'typescript',
  status: 'pending',
  createdAt: '2026-10-20T00:00:00.000Z',
  scopeId: 'task-1',
  source: { provider: 'github', repo: 'r/p', prNumber: 1 }
}

const cachedReport: ReportContent = {
  issues: [],
  score: 77,
  agentResults: {
    security: {
      score: 50,
      issues: [
        { line: 1, severity: 'critical', category: 'secret', message: SECRET, suggestion: '' }
      ]
    }
  }
}

beforeEach(() => {
  calls.length = 0
  vi.clearAllMocks()
  vi.mocked(queries.getTask).mockResolvedValue(task)
  vi.mocked(queries.getReviewCache).mockResolvedValue({
    reportContent: JSON.stringify(cachedReport),
    score: 10,
    model: 'fake-model'
  } as never)
})

describe('runClaimedTask 缓存命中路径', () => {
  it('回放报告先脱敏，使用报告综合评分，并在任务完成之后才回写 PR 评论', async () => {
    const outcome = await runClaimedTask('task-1', {} as TaskProducer, {} as unknown as AppConfig)

    expect(outcome).toBe('completed')
    expect(calls).toEqual(['saveReport', 'updateTaskStatus', 'comment'])

    const [, savedReport, savedScore] = vi.mocked(taskService.saveReport).mock.calls[0]
    expect(JSON.stringify(savedReport)).not.toContain(SECRET)
    expect(savedScore).toBe(77)

    const [, commented] = vi.mocked(commentReportToPullRequest).mock.calls[0]
    expect(JSON.stringify(commented)).not.toContain(SECRET)
  })

  it('任务置为完成后记账失败，不会退回正常执行且仍回写评论', async () => {
    vi.mocked(queries.bumpReviewCacheHit).mockRejectedValueOnce(new Error('db down'))

    const outcome = await runClaimedTask('task-1', {} as TaskProducer, {} as unknown as AppConfig)

    expect(outcome).toBe('completed')
    expect(commentReportToPullRequest).toHaveBeenCalledTimes(1)
  })

  it('缓存内容损坏时不按缓存完成，退回正常执行', async () => {
    vi.mocked(queries.getReviewCache).mockResolvedValue({
      reportContent: '{not json',
      score: 0,
      model: 'fake-model'
    } as never)
    vi.mocked(runReviewTask).mockResolvedValue(cachedReport)
    vi.mocked(queries.completeTask).mockResolvedValue(true as never)
    vi.mocked(queries.saveReviewCache).mockResolvedValue(undefined as never)

    const outcome = await runClaimedTask('task-1', {} as TaskProducer, normalRunConfig)

    expect(outcome).toBe('completed')
    expect(runReviewTask).toHaveBeenCalledTimes(1)
    expect(queries.updateTaskStatus).not.toHaveBeenCalled()
  })
})

describe('runClaimedTask 正常执行路径', () => {
  beforeEach(() => {
    vi.mocked(queries.getReviewCache).mockResolvedValue(null as never)
    vi.mocked(queries.saveReviewCache).mockResolvedValue(undefined as never)
    vi.mocked(runReviewTask).mockResolvedValue({ ...cachedReport, score: 81 })
    vi.mocked(queries.completeTask).mockImplementation(async () => {
      calls.push('completeTask')
      return true as never
    })
  })

  it('保存报告使用报告综合评分，PR 评论在 completeTask 之后', async () => {
    const outcome = await runClaimedTask('task-1', {} as TaskProducer, normalRunConfig)

    expect(outcome).toBe('completed')
    expect(vi.mocked(taskService.saveReport).mock.calls[0][2]).toBe(81)
    expect(calls).toEqual(['saveReport', 'completeTask', 'comment'])
  })

  it('收尾时任务已被取消则不回写评论', async () => {
    vi.mocked(queries.completeTask).mockResolvedValue(false as never)

    const outcome = await runClaimedTask('task-1', {} as TaskProducer, normalRunConfig)

    expect(outcome).toBe('cancelled')
    expect(commentReportToPullRequest).not.toHaveBeenCalled()
  })
})
