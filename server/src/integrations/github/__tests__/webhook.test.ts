import { createHmac } from 'node:crypto'
import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import {
  collectPullRequestCode,
  commentReportToPullRequest,
  createGitHubWebhookRouter,
  verifySignature
} from '../webhook'
import type { GitHubClient } from '../client'
import type { ReportContent, Task, TaskSource } from '../../../../../shared/types'

// 路由内部会读取 MAX_CODE_CHARS，提供最小可用配置
process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/test'
process.env.RABBITMQ_URL = 'amqp://localhost:5672'
process.env.LLM_API_KEY = 'test-key'

const SECRET = 'webhook-secret'

function sign(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(Buffer.from(body)).digest('hex')}`
}

function buildApp(deps: Parameters<typeof createGitHubWebhookRouter>[0]) {
  const app = express()
  app.use('/api/webhooks', createGitHubWebhookRouter(deps))
  return app
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
  return request(app)
    .post('/api/webhooks/github')
    .set('Content-Type', 'application/json')
    .set('X-Hub-Signature-256', headers.signature ?? sign(body))
    .set('X-GitHub-Event', headers.event ?? 'pull_request')
    .send(body)
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

  it('opened 事件创建任务并入队', async () => {
    const createReviewTask = vi.fn(async () => ({ id: 'task-1' }) as Task)
    const publishTask = vi.fn(async () => undefined)
    const body = JSON.stringify(payload)

    const res = await post(
      buildApp({ secret: SECRET, client: fakeClient(), createReviewTask, publishTask }),
      body
    )

    expect(res.status).toBe(202)
    expect(res.body.taskId).toBe('task-1')
    expect(publishTask).toHaveBeenCalledWith('task-1')

    const call = createReviewTask.mock.calls[0] as unknown as [string, string, string, TaskSource]
    expect(call[0]).toContain('// FILE: src/a.ts')
    expect(call[1]).toBe('mixed')
    expect(call[2]).toContain('PR #7')
    expect(call[3]).toEqual({
      provider: 'github',
      repo: 'ndbf-h/code-agent-review',
      prNumber: 7,
      headSha: 'abc123'
    })
  })

  it('没有可审查文件时返回 204 且不创建任务', async () => {
    const createReviewTask = vi.fn(async () => ({ id: 'task-1' }) as Task)
    const client = fakeClient({
      listPullRequestFiles: async () => [{ filename: 'assets/logo.png', status: 'added' }]
    })

    const res = await post(
      buildApp({ secret: SECRET, client, createReviewTask }),
      JSON.stringify(payload)
    )

    expect(res.status).toBe(204)
    expect(createReviewTask).not.toHaveBeenCalled()
  })
})

describe('collectPullRequestCode（REQ-15）', () => {
  it('按扩展名过滤，并遵守总量上限', async () => {
    const client = fakeClient({
      listPullRequestFiles: async () => [
        { filename: 'src/a.ts', status: 'modified' },
        { filename: 'assets/logo.png', status: 'added' },
        { filename: 'src/b.py', status: 'modified' }
      ],
      getFileContent: async (_repo, path) =>
        path.endsWith('.py') ? 'x'.repeat(200) : 'const a = 1'
    })

    const code = await collectPullRequestCode(client, 'r/p', 1, 'sha', 1000)
    expect(code).toContain('// FILE: src/a.ts')
    expect(code).toContain('// FILE: src/b.py')
    expect(code).not.toContain('logo.png')

    const limited = await collectPullRequestCode(client, 'r/p', 1, 'sha', 40)
    expect(limited).toContain('src/a.ts')
    expect(limited).not.toContain('src/b.py')
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

    expect(await collectPullRequestCode(client, 'r/p', 1, 'sha', 1000)).toContain('@@ -1 +1 @@')
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
