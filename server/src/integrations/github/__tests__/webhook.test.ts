import { createHmac } from 'node:crypto'
import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import {
  collectPullRequestCode,
  commentReportToPullRequest,
  createGitHubWebhookRouter,
  describeSkippedFiles,
  githubDedupeKey,
  languageOfFile,
  verifySignature
} from '../webhook'
import { DuplicateTaskError } from '../../../errors'
import type { GitHubClient } from '../client'
import type { PublishTask, SubmitReviewTaskInput } from '../../../services/taskService'
import type { ReportContent, Task, TaskSource } from '../../../../../shared/types'

// 路由内部会读取 MAX_CODE_CHARS，提供最小可用配置
process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/test'
process.env.RABBITMQ_URL = 'amqp://localhost:5672'
process.env.LLM_API_KEY = 'test-key'

const SECRET = 'webhook-secret'

function sign(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(Buffer.from(body)).digest('hex')}`
}

function buildApp(deps: Partial<Parameters<typeof createGitHubWebhookRouter>[0]>) {
  const app = express()
  app.use(
    '/api/webhooks',
    createGitHubWebhookRouter({ publishTask: vi.fn(async () => undefined), ...deps })
  )
  return app
}

/** 捕获后台任务的调度器：测试中显式等待后台处理完成 */
function captureSchedule() {
  const jobs: Promise<void>[] = []
  return {
    schedule: (job: () => Promise<void>) => {
      jobs.push(job())
    },
    settled: () => Promise.all(jobs),
    get count() {
      return jobs.length
    }
  }
}

const payload = {
  action: 'opened',
  repository: { full_name: 'ndbf-h/code-agent-review' },
  pull_request: { number: 7, head: { sha: 'abc123' } }
}

function fakeClient(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    listPullRequestFiles: async () => [{ filename: 'src/a.ts', status: 'modified' }],
    getFileContent: async () => 'const a = 1',
    createIssueComment: async () => undefined,
    ...overrides
  }
}

function post(app: express.Express, body: string, headers: Record<string, string> = {}) {
  const req = request(app)
    .post('/api/webhooks/github')
    .set('Content-Type', 'application/json')
    .set('X-Hub-Signature-256', headers.signature ?? sign(body))
    .set('X-GitHub-Event', headers.event ?? 'pull_request')
  if (headers.delivery) req.set('X-GitHub-Delivery', headers.delivery)
  return req.send(body)
}

describe('verifySignature（REQ-15）', () => {
  const raw = Buffer.from('{"a":1}')

  it('正确签名通过', () => {
    expect(verifySignature(raw, sign('{"a":1}'), SECRET)).toBe(true)
  })

  it('错误签名、缺失头部、空密钥均不通过', () => {
    expect(verifySignature(raw, 'sha256=deadbeef', SECRET)).toBe(false)
    expect(verifySignature(raw, undefined, SECRET)).toBe(false)
    expect(verifySignature(raw, sign('{"a":1}'), '')).toBe(false)
  })
})

describe('GitHub Webhook 路由（REQ-15）', () => {
  it('未配置密钥时返回 404', async () => {
    const res = await post(buildApp({}), '{}')
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('WEBHOOK_DISABLED')
  })

  it('签名不合法返回 401', async () => {
    const res = await post(buildApp({ secret: SECRET, client: fakeClient() }), '{}', {
      signature: 'sha256=bad'
    })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('WEBHOOK_UNAUTHORIZED')
  })

  it('非 pull_request 事件返回 204', async () => {
    const res = await post(buildApp({ secret: SECRET, client: fakeClient() }), '{}', {
      event: 'issues'
    })
    expect(res.status).toBe(204)
  })

  it('非目标 action 返回 204', async () => {
    const body = JSON.stringify({ ...payload, action: 'closed' })
    const res = await post(buildApp({ secret: SECRET, client: fakeClient() }), body)
    expect(res.status).toBe(204)
  })

  it('opened 事件先应答 202，后台经 submitTask 创建任务并入队', async () => {
    const submitTask = vi.fn(async () => ({ id: 'task-1' }) as Task)
    const publishTask = vi.fn(async () => undefined)
    const background = captureSchedule()
    const body = JSON.stringify(payload)

    const res = await post(
      buildApp({
        secret: SECRET,
        client: fakeClient(),
        submitTask,
        publishTask,
        schedule: background.schedule
      }),
      body,
      { delivery: 'delivery-1' }
    )

    expect(res.status).toBe(202)
    expect(res.body).toEqual({ accepted: true, deliveryId: 'delivery-1' })
    await background.settled()

    const [input, publisher] = submitTask.mock.calls[0] as unknown as [
      SubmitReviewTaskInput,
      PublishTask
    ]
    // 入队函数原样交给 submitReviewTask，由它负责 agents / task_queued / 入队的完整流程
    expect(publisher).toBe(publishTask)
    expect(input.code).toContain('// FILE: src/a.ts (typescript)')
    expect(input.language).toBe('typescript')
    expect(input.title).toContain('PR #7')
    expect(input.dedupeKey).toBe(githubDedupeKey('ndbf-h/code-agent-review', 7, 'abc123'))
    expect(input.source).toEqual({
      provider: 'github',
      repo: 'ndbf-h/code-agent-review',
      prNumber: 7,
      headSha: 'abc123'
    } satisfies TaskSource)
  })

  it('拉取文件挂起时路由仍立即返回 202', async () => {
    const background = captureSchedule()
    const client = fakeClient({ listPullRequestFiles: () => new Promise(() => undefined) })

    const res = await post(
      buildApp({ secret: SECRET, client, schedule: background.schedule }),
      JSON.stringify(payload)
    )

    expect(res.status).toBe(202)
    expect(background.count).toBe(1)
  })

  it('重复投递（去重键冲突）只记日志，不抛出', async () => {
    const submitTask = vi.fn(async (input: SubmitReviewTaskInput) => {
      throw new DuplicateTaskError(input.dedupeKey ?? '')
    })
    const background = captureSchedule()

    const res = await post(
      buildApp({ secret: SECRET, client: fakeClient(), submitTask, schedule: background.schedule }),
      JSON.stringify(payload)
    )

    expect(res.status).toBe(202)
    await expect(background.settled()).resolves.toBeDefined()
    expect(submitTask).toHaveBeenCalledTimes(1)
  })

  it('同一 headSha 重投 3 次只创建 1 个任务', async () => {
    const created = new Set<string>()
    const submitTask = vi.fn(async (input: SubmitReviewTaskInput) => {
      // 模拟 dedupe_key 唯一索引
      if (created.has(input.dedupeKey!)) throw new DuplicateTaskError(input.dedupeKey!)
      created.add(input.dedupeKey!)
      return { id: `task-${created.size}` } as Task
    })
    const background = captureSchedule()
    const app = buildApp({
      secret: SECRET,
      client: fakeClient(),
      submitTask,
      schedule: background.schedule
    })

    for (let i = 0; i < 3; i++) {
      expect((await post(app, JSON.stringify(payload))).status).toBe(202)
    }
    await background.settled()

    expect(submitTask).toHaveBeenCalledTimes(3)
    expect(created.size).toBe(1)
  })

  it('没有可审查文件时不创建任务', async () => {
    const submitTask = vi.fn(async () => ({ id: 'task-1' }) as Task)
    const background = captureSchedule()
    const client = fakeClient({
      listPullRequestFiles: async () => [{ filename: 'assets/logo.png', status: 'added' }]
    })

    const res = await post(
      buildApp({ secret: SECRET, client, submitTask, schedule: background.schedule }),
      JSON.stringify(payload)
    )
    await background.settled()

    expect(res.status).toBe(202)
    expect(submitTask).not.toHaveBeenCalled()
  })

  it('后台处理失败不影响已返回的应答', async () => {
    const submitTask = vi.fn(async () => {
      throw new Error('db down')
    })
    const background = captureSchedule()

    const res = await post(
      buildApp({ secret: SECRET, client: fakeClient(), submitTask, schedule: background.schedule }),
      JSON.stringify(payload)
    )

    expect(res.status).toBe(202)
    await expect(background.settled()).resolves.toBeDefined()
  })

  it('请求体上限取自配置（超出返回 413）', async () => {
    const body = JSON.stringify({ ...payload, padding: 'x'.repeat(2048) })
    const res = await post(buildApp({ secret: SECRET, maxBodySize: '1kb' }), body)
    expect(res.status).toBe(413)
  })
})

describe('collectPullRequestCode（REQ-15）', () => {
  it('按扩展名过滤，并标注每个文件的语言', async () => {
    const client = fakeClient({
      listPullRequestFiles: async () => [
        { filename: 'src/a.ts', status: 'modified' },
        { filename: 'assets/logo.png', status: 'added' },
        { filename: 'src/b.py', status: 'modified' }
      ],
      getFileContent: async (_repo, path) =>
        path.endsWith('.py') ? 'x'.repeat(200) : 'const a = 1'
    })

    const result = await collectPullRequestCode(client, 'r/p', 1, 'sha', { maxChars: 1000 })
    expect(result.code).toContain('// FILE: src/a.ts (typescript)')
    expect(result.code).toContain('// FILE: src/b.py (python)')
    expect(result.code).not.toContain('logo.png')
    expect(result.files).toEqual(['src/a.ts', 'src/b.py'])
    expect(result.skipped).toEqual([])
  })

  it('超出总量的大文件被跳过，后续小文件仍被收集', async () => {
    const client = fakeClient({
      listPullRequestFiles: async () => [
        { filename: 'src/big.ts', status: 'modified' },
        { filename: 'src/small.ts', status: 'modified' }
      ],
      getFileContent: async (_repo, path) =>
        path.endsWith('big.ts') ? 'x'.repeat(500) : 'const a = 1'
    })

    const result = await collectPullRequestCode(client, 'r/p', 1, 'sha', { maxChars: 100 })
    expect(result.files).toEqual(['src/small.ts'])
    expect(result.skipped).toEqual([{ filename: 'src/big.ts', reason: 'file-too-large' }])
  })

  it('总量上限按累计体积生效', async () => {
    const client = fakeClient({
      listPullRequestFiles: async () => [
        { filename: 'src/a.ts', status: 'modified' },
        { filename: 'src/b.ts', status: 'modified' },
        { filename: 'src/c.ts', status: 'modified' }
      ],
      getFileContent: async () => 'y'.repeat(40)
    })

    // 每段 = "// FILE: src/x.ts (typescript)\n"（31）+ 40 = 71，段间分隔 2：两段 144，三段 217
    const result = await collectPullRequestCode(client, 'r/p', 1, 'sha', { maxChars: 150 })
    expect(result.files).toEqual(['src/a.ts', 'src/b.ts'])
    expect(result.skipped).toEqual([{ filename: 'src/c.ts', reason: 'total-limit' }])
  })

  it('单文件上限生效', async () => {
    const client = fakeClient({
      listPullRequestFiles: async () => [
        { filename: 'src/a.ts', status: 'modified' },
        { filename: 'src/b.ts', status: 'modified' }
      ],
      getFileContent: async (_repo, path) => (path.endsWith('a.ts') ? 'z'.repeat(60) : 'ok')
    })

    const result = await collectPullRequestCode(client, 'r/p', 1, 'sha', {
      maxChars: 1000,
      maxFileChars: 50
    })
    expect(result.files).toEqual(['src/b.ts'])
    expect(result.skipped).toEqual([{ filename: 'src/a.ts', reason: 'file-too-large' }])
  })

  it('内容拉取失败时回退到 diff 片段', async () => {
    const client = fakeClient({
      listPullRequestFiles: async () => [
        { filename: 'src/a.ts', status: 'modified', patch: '@@ -1 +1 @@' }
      ],
      getFileContent: async () => {
        throw new Error('too large')
      }
    })

    const result = await collectPullRequestCode(client, 'r/p', 1, 'sha', { maxChars: 1000 })
    expect(result.code).toContain('@@ -1 +1 @@')
  })

  describe('主语言推断', () => {
    function clientWith(files: { filename: string; additions?: number; deletions?: number }[]) {
      return fakeClient({
        listPullRequestFiles: async () => files.map(f => ({ ...f, status: 'modified' })),
        getFileContent: async () => 'code'
      })
    }

    it('只有一种语言时使用该语言', async () => {
      const result = await collectPullRequestCode(
        clientWith([{ filename: 'a.py' }, { filename: 'b.py' }]),
        'r/p',
        1,
        'sha',
        { maxChars: 1000 }
      )
      expect(result.language).toBe('python')
    })

    it('多种语言时取变更行数最多者', async () => {
      const result = await collectPullRequestCode(
        clientWith([
          { filename: 'a.ts', additions: 5, deletions: 1 },
          { filename: 'b.go', additions: 30, deletions: 10 },
          { filename: 'c.tsx', additions: 20, deletions: 0 }
        ]),
        'r/p',
        1,
        'sha',
        { maxChars: 1000 }
      )
      // typescript 合计 26 行，go 40 行
      expect(result.language).toBe('go')
    })

    it('同语言不同扩展名合并计数', async () => {
      const result = await collectPullRequestCode(
        clientWith([
          { filename: 'a.js', additions: 10 },
          { filename: 'b.mjs', additions: 10 },
          { filename: 'c.py', additions: 15 }
        ]),
        'r/p',
        1,
        'sha',
        { maxChars: 1000 }
      )
      expect(result.language).toBe('javascript')
    })

    it('没有可审查文件时为 mixed', async () => {
      const result = await collectPullRequestCode(
        clientWith([{ filename: 'README.md' }]),
        'r/p',
        1,
        'sha',
        { maxChars: 1000 }
      )
      expect(result.language).toBe('mixed')
      expect(result.code).toBe('')
    })
  })
})

describe('Webhook 辅助函数', () => {
  it('languageOfFile 按扩展名映射，大小写不敏感', () => {
    expect(languageOfFile('src/App.VUE')).toBe('vue')
    expect(languageOfFile('lib/x.h')).toBe('c')
    expect(languageOfFile('Makefile')).toBeNull()
    expect(languageOfFile('a.md')).toBeNull()
  })

  it('describeSkippedFiles 列出文件与原因，超过 20 个时截断', () => {
    expect(describeSkippedFiles([])).toBeUndefined()
    expect(describeSkippedFiles([{ filename: 'a.ts', reason: 'total-limit' }])).toBe(
      '以下文件未纳入审查：a.ts（总量超限）'
    )
    const many = Array.from({ length: 25 }, (_, i) => ({
      filename: `f${i}.ts`,
      reason: 'file-too-large' as const
    }))
    const text = describeSkippedFiles(many)!
    expect(text).toContain('f19.ts')
    expect(text).not.toContain('f20.ts')
    expect(text).toContain('等 25 个')
  })
})

describe('commentReportToPullRequest（REQ-15）', () => {
  const baseTask: Task = {
    id: 't1',
    title: 'demo',
    codeSnippet: 'x',
    language: 'typescript',
    status: 'completed',
    createdAt: '2026-09-20T00:00:00.000Z',
    scopeId: 's1'
  }
  const report: ReportContent = { issues: [], score: 90, agentResults: {} }

  it('非 GitHub 来源的任务直接跳过', async () => {
    const createIssueComment = vi.fn(async () => undefined)
    await commentReportToPullRequest(baseTask, report, fakeClient({ createIssueComment }))
    expect(createIssueComment).not.toHaveBeenCalled()
  })

  it('GitHub 任务回写 Markdown 报告', async () => {
    const createIssueComment = vi.fn(async () => undefined)
    const task: Task = {
      ...baseTask,
      source: { provider: 'github', repo: 'r/p', prNumber: 3 }
    }

    await commentReportToPullRequest(task, report, fakeClient({ createIssueComment }))

    expect(createIssueComment).toHaveBeenCalledWith(
      'r/p',
      3,
      expect.stringContaining('# 代码审查报告')
    )
  })

  it('回写失败不抛出，不影响任务状态', async () => {
    const client = fakeClient({
      createIssueComment: async () => {
        throw new Error('403')
      }
    })
    const task: Task = {
      ...baseTask,
      source: { provider: 'github', repo: 'r/p', prNumber: 3 }
    }

    await expect(commentReportToPullRequest(task, report, client)).resolves.toBeUndefined()
  })
})
