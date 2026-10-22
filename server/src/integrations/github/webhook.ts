import { createHmac, timingSafeEqual } from 'node:crypto'
import express, { Router, type Request, type Response } from 'express'
import { getConfig } from '../../config'
import { DuplicateTaskError } from '../../errors'
import { createLogger } from '../../logger'
import {
  submitReviewTask,
  type PublishTask,
  type SubmitReviewTaskInput
} from '../../services/taskService'
import { renderReportMarkdown } from '../../export/markdown'
import { createGitHubClient, type GitHubClient } from './client'
import type { ReportContent, Task, TaskSource } from '../../../../shared/types'

const logger = createLogger('github-webhook')

/**
 * 参与审查的文件扩展名 → 语言（与前端支持的语言、SARIF 扩展名映射保持一致）。
 * 同时充当白名单：不在表中的文件不参与审查。
 */
const EXTENSION_LANGUAGES: Record<string, string> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.vue': 'vue',
  '.py': 'python',
  '.go': 'go',
  '.java': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.rs': 'rust',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.sql': 'sql'
}

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

/** 按扩展名推断文件语言；不在白名单中的文件返回 null */
export function languageOfFile(filename: string): string | null {
  const lower = filename.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return null
  return EXTENSION_LANGUAGES[lower.slice(dot)] ?? null
}

/** GitHub 来源任务的去重键：同一仓库、同一 PR、同一 head 提交只审查一次 */
export function githubDedupeKey(repo: string, prNumber: number, headSha: string): string {
  return `github:${repo}#${prNumber}@${headSha}`
}

export interface GitHubWebhookDeps {
  /** 未配置时路由返回 404（功能未启用） */
  secret?: string
  client?: GitHubClient
  /** 任务入队函数（必填：Webhook 创建的任务必须进入队列才会被执行） */
  publishTask: PublishTask
  /** 任务提交依赖注入，便于单测；默认走 taskService.submitReviewTask */
  submitTask?: (input: SubmitReviewTaskInput, publishTask: PublishTask) => Promise<Task>
  /** 单次审查代码总量上限，默认取 MAX_CODE_CHARS */
  maxCodeChars?: number
  /** 单文件字符上限，默认取 GITHUB_MAX_FILE_CHARS（MAX_CODE_CHARS 的 1/4） */
  maxFileChars?: number
  /** 原始请求体上限，默认取 MAX_BODY_SIZE */
  maxBodySize?: string
  /**
   * 后台处理调度器：路由先应答 202，再交给它执行拉取文件与建任务。
   * 默认 setImmediate；单测可注入同步执行或捕获 Promise。
   */
  schedule?: (job: () => Promise<void>) => void
}

/** 被跳过的文件及原因 */
export interface SkippedFile {
  filename: string
  reason: 'file-too-large' | 'total-limit' | 'empty'
}

export interface CollectedPullRequestCode {
  code: string
  /** 主语言：仅一种语言时即该语言；多种语言时取变更行数最多者；无文件时为 'mixed' */
  language: string
  files: string[]
  skipped: SkippedFile[]
}

export interface CollectLimits {
  /** 拼接后的代码总量上限 */
  maxChars: number
  /** 单文件上限，缺省与总量上限相同 */
  maxFileChars?: number
}

/**
 * 把 PR 变更文件拼成一个待审代码块：
 * - 只收集白名单扩展名，`// FILE: <path> (<语言>)` 分隔各文件
 * - 单文件超限或会撑破总量的文件跳过并记录，后续较小的文件仍继续收集
 */
export async function collectPullRequestCode(
  client: GitHubClient,
  repo: string,
  prNumber: number,
  headSha: string,
  limits: CollectLimits
): Promise<CollectedPullRequestCode> {
  const maxFileChars = Math.min(limits.maxFileChars ?? limits.maxChars, limits.maxChars)
  const files = await client.listPullRequestFiles(repo, prNumber)
  const chunks: string[] = []
  const collected: string[] = []
  const skipped: SkippedFile[] = []
  const changesByLanguage = new Map<string, number>()
  let total = 0

  for (const file of files) {
    const language = languageOfFile(file.filename)
    if (!language) continue
    let content: string
    try {
      content = await client.getFileContent(repo, file.filename, headSha)
    } catch {
      // 大文件或权限不足时退回 diff 片段
      content = file.patch ?? ''
    }
    if (!content.trim()) {
      skipped.push({ filename: file.filename, reason: 'empty' })
      continue
    }
    if (content.length > maxFileChars) {
      skipped.push({ filename: file.filename, reason: 'file-too-large' })
      continue
    }

    const piece = `// FILE: ${file.filename} (${language})\n${content}`
    const separator = chunks.length > 0 ? 2 : 0
    if (total + separator + piece.length > limits.maxChars) {
      skipped.push({ filename: file.filename, reason: 'total-limit' })
      continue
    }
    chunks.push(piece)
    collected.push(file.filename)
    total += separator + piece.length
    const changes = (file.additions ?? 0) + (file.deletions ?? 0) || 1
    changesByLanguage.set(language, (changesByLanguage.get(language) ?? 0) + changes)
  }

  return {
    code: chunks.join('\n\n'),
    language: dominantLanguage(changesByLanguage),
    files: collected,
    skipped
  }
}

/** 变更行数最多的语言；并列时取先出现者；没有文件时为 'mixed' */
function dominantLanguage(changesByLanguage: Map<string, number>): string {
  let best = 'mixed'
  let bestChanges = -1
  for (const [language, changes] of changesByLanguage) {
    if (changes > bestChanges) {
      best = language
      bestChanges = changes
    }
  }
  return best
}

const SKIP_REASON_LABELS: Record<SkippedFile['reason'], string> = {
  'file-too-large': '单文件超限',
  'total-limit': '总量超限',
  empty: '内容为空'
}

/** 跳过文件的说明，写入 task_queued 事件；最多列 20 个，避免事件过大 */
export function describeSkippedFiles(skipped: SkippedFile[]): string | undefined {
  if (skipped.length === 0) return undefined
  const listed = skipped
    .slice(0, 20)
    .map(s => `${s.filename}（${SKIP_REASON_LABELS[s.reason]}）`)
    .join('、')
  const more = skipped.length > 20 ? ` 等 ${skipped.length} 个` : ''
  return `以下文件未纳入审查：${listed}${more}`
}

/** 处理一次已校验的 PR 事件：拉取文件 → 建任务 → 入队。在应答之后执行，错误只记日志。 */
async function processPullRequest(
  deps: GitHubWebhookDeps,
  event: { repo: string; prNumber: number; headSha: string; deliveryId?: string }
): Promise<void> {
  const { repo, prNumber, headSha, deliveryId } = event
  try {
    const config = getConfig()
    const client = deps.client ?? createGitHubClient()
    const collected = await collectPullRequestCode(client, repo, prNumber, headSha, {
      maxChars: deps.maxCodeChars ?? config.http.maxCodeChars,
      maxFileChars: deps.maxFileChars ?? config.github.maxFileChars
    })
    if (!collected.code.trim()) {
      logger.info('PR 没有可审查的文件，跳过', { repo, prNumber, deliveryId })
      return
    }

    const source: TaskSource = { provider: 'github', repo, prNumber, headSha }
    const skippedSuffix =
      collected.skipped.length > 0 ? `，跳过 ${collected.skipped.length} 个文件` : ''
    const submit = deps.submitTask ?? submitReviewTask
    const task = await submit(
      {
        code: collected.code,
        language: collected.language,
        title: `PR #${prNumber} 代码审查（${repo}${skippedSuffix}）`,
        source,
        dedupeKey: githubDedupeKey(repo, prNumber, headSha),
        queueNotice: describeSkippedFiles(collected.skipped)
      },
      deps.publishTask
    )
    logger.info('GitHub Webhook 已创建审查任务', {
      taskId: task.id,
      repo,
      prNumber,
      headSha,
      deliveryId,
      files: collected.files.length,
      skipped: collected.skipped.length
    })
  } catch (error) {
    if (error instanceof DuplicateTaskError) {
      // GitHub 超时重投或同一提交的重复事件：已有任务，不再重复审查与评论
      logger.info('重复的 PR 事件，已忽略', { repo, prNumber, headSha, deliveryId })
      return
    }
    logger.error('GitHub Webhook 后台处理失败', { repo, prNumber, headSha, deliveryId, error })
  }
}

const defaultSchedule = (job: () => Promise<void>): void => {
  setImmediate(() => void job())
}

/**
 * GitHub Webhook 路由（REQ-15）。
 * 使用 express.raw 获取原始请求体做 HMAC 校验，因此必须在 express.json() 之前挂载。
 *
 * 校验通过后立即应答 202，拉取文件与建任务在后台进行：GitHub 的投递超时约 10 秒，
 * 同步处理大 PR 会超时并触发重投。重投由 dedupe_key 唯一索引兜底去重。
 */
export function createGitHubWebhookRouter(deps: GitHubWebhookDeps): Router {
  const router = Router()
  const schedule = deps.schedule ?? defaultSchedule

  router.post(
    '/github',
    // 请求体上限与 express.json 一致（MAX_BODY_SIZE），在首个请求时读取配置
    (req, res, next) =>
      express.raw({ type: '*/*', limit: deps.maxBodySize ?? getConfig().http.maxBodySize })(
        req,
        res,
        next
      ),
    (req: Request, res: Response) => {
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

      const deliveryId = req.get('x-github-delivery') ?? undefined
      logger.info('收到 PR 事件，转入后台处理', {
        repo,
        prNumber,
        headSha,
        action: payload.action,
        deliveryId
      })
      res.status(202).json({ accepted: true, deliveryId })
      schedule(() => processPullRequest(deps, { repo, prNumber, headSha, deliveryId }))
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
