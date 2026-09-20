import { createHmac, timingSafeEqual } from 'node:crypto'
import express, { Router, type Request, type Response } from 'express'
import { getConfig } from '../../config'
import { createLogger } from '../../logger'
import { createTask } from '../../services/taskService'
import { renderReportMarkdown } from '../../export/markdown'
import { createGitHubClient, type GitHubClient } from './client'
import type { ReportContent, Task, TaskSource } from '../../../../shared/types'

const logger = createLogger('github-webhook')

/** 参与审查的文件扩展名白名单（与前端支持的语言保持一致） */
const REVIEWABLE_EXTENSIONS = [
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.vue',
  '.py',
  '.go',
  '.java',
  '.rb',
  '.php',
  '.cs',
  '.cpp',
  '.cc',
  '.c',
  '.h',
  '.rs',
  '.kt',
  '.swift',
  '.sql'
]

/** 触发审查的 PR 动作 */
const REVIEW_ACTIONS = ['opened', 'synchronize', 'reopened']

interface PullRequestPayload {
  action?: string
  number?: number
  repository?: { full_name?: string }
  pull_request?: { number?: number; head?: { sha?: string } }
}

/** HMAC SHA-256 签名校验，恒定时间比较避免时序侧信道 */
export function verifySignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!secret || !signatureHeader) return false
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  )
  const provided = Buffer.from(signatureHeader.trim())
  if (expected.length !== provided.length) return false
  return timingSafeEqual(expected, provided)
}

function isReviewable(filename: string): boolean {
  const lower = filename.toLowerCase()
  return REVIEWABLE_EXTENSIONS.some(ext => lower.endsWith(ext))
}

export interface GitHubWebhookDeps {
  /** 未配置时路由返回 404（功能未启用） */
  secret?: string
  client?: GitHubClient
  /** 任务创建与入队依赖注入，便于单测 */
  createReviewTask?: (
    code: string,
    language: string,
    title: string,
    source: TaskSource
  ) => Promise<Task>
  publishTask?: (taskId: string) => Promise<void>
  /** 单次审查代码总量上限，默认取 MAX_CODE_CHARS */
  maxCodeChars?: number
}

/** 把 PR 变更文件拼成一个待审代码块，遵守单文件过滤与总量上限 */
export async function collectPullRequestCode(
  client: GitHubClient,
  repo: string,
  prNumber: number,
  headSha: string,
  maxChars: number
): Promise<string> {
  const files = await client.listPullRequestFiles(repo, prNumber)
  const chunks: string[] = []
  let total = 0

  for (const file of files) {
    if (!isReviewable(file.filename)) continue
    let content: string
    try {
      content = await client.getFileContent(repo, file.filename, headSha)
    } catch {
      // 大文件或权限不足时退回 diff 片段
      content = file.patch ?? ''
    }
    if (!content.trim()) continue

    const piece = `// FILE: ${file.filename}\n${content}`
    if (total + piece.length > maxChars) break
    chunks.push(piece)
    total += piece.length
  }

  return chunks.join('\n\n')
}

async function defaultCreateReviewTask(
  code: string,
  language: string,
  title: string,
  source: TaskSource
): Promise<Task> {
  return createTask(code, language, title, undefined, undefined, source)
}

/**
 * GitHub Webhook 路由（REQ-15）。
 * 使用 express.raw 获取原始请求体做 HMAC 校验，因此必须在 express.json() 之前挂载。
 */
export function createGitHubWebhookRouter(deps: GitHubWebhookDeps): Router {
  const router = Router()

  router.post(
    '/github',
    express.raw({ type: '*/*', limit: '5mb' }),
    async (req: Request, res: Response) => {
      if (!deps.secret) {
        res.status(404).json({ error: 'GitHub Webhook 未启用', code: 'WEBHOOK_DISABLED' })
        return
      }

      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ''))
      if (!verifySignature(rawBody, req.get('x-hub-signature-256'), deps.secret)) {
        res.status(401).json({ error: '签名校验失败', code: 'WEBHOOK_UNAUTHORIZED' })
        return
      }

      if (req.get('x-github-event') !== 'pull_request') {
        res.status(204).end()
        return
      }

      let payload: PullRequestPayload
      try {
        payload = JSON.parse(rawBody.toString('utf-8')) as PullRequestPayload
      } catch {
        res.status(400).json({ error: '请求体不是合法 JSON', code: 'INVALID_JSON' })
        return
      }

      if (!REVIEW_ACTIONS.includes(payload.action ?? '')) {
        res.status(204).end()
        return
      }

      const repo = payload.repository?.full_name
      const prNumber = payload.pull_request?.number ?? payload.number
      const headSha = payload.pull_request?.head?.sha
      if (!repo || !prNumber || !headSha) {
        res.status(204).end()
        return
      }

      try {
        const client = deps.client ?? createGitHubClient()
        const maxChars = deps.maxCodeChars ?? getConfig().http.maxCodeChars
        const code = await collectPullRequestCode(client, repo, prNumber, headSha, maxChars)
        if (!code.trim()) {
          res.status(204).end()
          return
        }

        const source: TaskSource = { provider: 'github', repo, prNumber, headSha }
        const create = deps.createReviewTask ?? defaultCreateReviewTask
        const task = await create(code, 'mixed', `PR #${prNumber} 代码审查（${repo}）`, source)

        if (deps.publishTask) {
          await deps.publishTask(task.id)
        } else {
          logger.warn('未注入任务发布器，Webhook 任务未入队', { taskId: task.id })
        }

        logger.info('GitHub Webhook 已创建审查任务', { taskId: task.id, repo, prNumber })
        res.status(202).json({ taskId: task.id })
      } catch (error) {
        logger.error('GitHub Webhook 处理失败', { repo, prNumber, error })
        res.status(500).json({ error: 'Webhook 处理失败', code: 'INTERNAL_ERROR' })
      }
    }
  )

  return router
}

/** 任务完成后把 Markdown 报告回写到 PR 评论；失败只记日志，不影响任务状态 */
export async function commentReportToPullRequest(
  task: Task,
  report: ReportContent,
  client?: GitHubClient
): Promise<void> {
  const source = task.source
  if (source?.provider !== 'github') return
  try {
    const gh = client ?? createGitHubClient()
    await gh.createIssueComment(source.repo, source.prNumber, renderReportMarkdown(task, report))
    logger.info('已回写 PR 评论', { taskId: task.id, repo: source.repo, prNumber: source.prNumber })
  } catch (error) {
    logger.warn('PR 评论回写失败（不影响任务状态）', { taskId: task.id, error })
  }
}
