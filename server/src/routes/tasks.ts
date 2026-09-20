import { Router, type Request, type Response, type NextFunction } from 'express'
import { ValidationError, TaskError } from '../errors'
import { createTask, createAgentsForTask, getTaskDetail } from '../services/taskService'
import {
  listTasks,
  countTasks,
  getTask,
  getTaskEventsAfter,
  markTaskFailed,
  getReportByTask,
  getConversationMessages,
  insertConversationMessage,
  insertCodeVersion,
  linkCodeVersionToReview,
  aggregateTaskMetrics,
  recentTaskFailures,
  getReviewCacheStats,
  cancelTask
} from '../db/queries'
import { getAgentLatency, resetAgentLatency } from '../agent/orchestrator'
import type { ReviewEvent } from '../agent/orchestrator'
import { applyFixes } from '../tools/fix'
import type { FixChange } from '../tools/fix'
import type { Issue, ReportContent, TaskStatus } from '../../../shared/types'
import { getTokenUsage, getRequestCount, resetTokenUsage } from '../agent/llm-client'
import { resolveAndCheckIp as resolveAndCheckIpSafe } from '../utils/urlSafety'
import { streamAssistantReply } from '../services/assistantService'
import { addGuidelineDocument } from '../services/knowledgeService'
import {
  subscribeTaskEvents,
  appendTaskEvent,
  type StoredTaskEvent
} from '../services/eventService'
import type { TaskProducer } from '../queue/producer'
import { v4 as uuidv4 } from 'uuid'
import { getConfig } from '../config'
import { createLogger } from '../logger'
import { validate, getValidated } from '../validation/middleware'
import { renderReportMarkdown } from '../export/markdown'
import { renderSarif } from '../export/sarif'
import {
  taskIdParamsSchema,
  createTaskBodySchema,
  listTasksQuerySchema,
  chatBodySchema,
  versionBodySchema,
  guidelineBodySchema,
  fixBodySchema,
  fetchUrlBodySchema,
  type CreateTaskBody,
  type ListTasksQuery,
  type ChatBody,
  type VersionBody,
  type GuidelineBody,
  type FixBody,
  type FetchUrlBody
} from '../validation/schemas'

const logger = createLogger('tasks')

const tasksRouter = Router()
const metricsRouter = Router()

/** 带路径参数的路由请求类型（express 5 起 params 值可能为数组，需显式收窄为 string） */
type TaskIdRequest = Request<{ id: string }>

/** 所有 /:id 路径参数统一要求 UUID */
const withTaskId = validate({ params: taskIdParamsSchema })

/** SSE 心跳间隔：定时发送注释行，防止代理按空闲超时断开长连接 */
const SSE_HEARTBEAT_INTERVAL_MS = 20_000

/** 启动 SSE 心跳，连接关闭或响应结束时自动清理定时器 */
function startSseHeartbeat(res: Response): ReturnType<typeof setInterval> {
  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(heartbeat)
      return
    }
    res.write(': ping\n\n')
  }, SSE_HEARTBEAT_INTERVAL_MS)
  res.on('close', () => clearInterval(heartbeat))
  res.on('finish', () => clearInterval(heartbeat))
  return heartbeat
}

/** 终态事件：task_completed / task_cancelled，或无 agentId 的全局 error（带 agentId 的 error 只是单个审查员失败） */
function isTerminalEvent(event: { type: string; agentId?: string }): boolean {
  return (
    event.type === 'task_completed' ||
    event.type === 'task_cancelled' ||
    (event.type === 'error' && !event.agentId)
  )
}

let taskProducer: TaskProducer | null = null

/** 注入任务队列发布器（index.ts 启动时调用，路由随后才能入队任务） */
export function setTaskProducer(producer: TaskProducer): void {
  taskProducer = producer
}

function requireProducer(): TaskProducer {
  if (!taskProducer) throw new Error('任务队列发布器尚未初始化')
  return taskProducer
}

// POST /api/tasks
tasksRouter.post(
  '/',
  validate({ body: createTaskBodySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // reviewConfig 目前仅校验形状（REQ-04），落库并生效由 REQ-14（批次 7）实现
      const { code, language, title, scopeId, sourceVersionId } = req.body as CreateTaskBody

      const task = await createTask(code, language, title, scopeId)
      await createAgentsForTask(task.id)
      if (sourceVersionId) await linkCodeVersionToReview(sourceVersionId, task.id)

      await appendTaskEvent(task.id, { type: 'task_queued', message: '任务已创建，进入审查队列' })
      try {
        await requireProducer().publishTask(task.id)
      } catch (error) {
        // publisher confirm 失败说明 broker 未收到消息：任务标记失败并明确告知调用方
        logger.error('任务入队失败', { taskId: task.id, error })
        await markTaskFailed(task.id)
        await appendTaskEvent(task.id, {
          type: 'error',
          message: '消息队列暂不可用，任务未能入队'
        }).catch(() => undefined)
        res.status(502).json({ error: '消息队列暂不可用，请稍后重试', code: 'QUEUE_UNAVAILABLE' })
        return
      }

      res.status(201).json(task)
    } catch (error) {
      next(error)
    }
  }
)

// POST /api/tasks/:id/cancel — 取消排队中/执行中的审查任务
tasksRouter.post(
  '/:id/cancel',
  withTaskId,
  async (req: TaskIdRequest, res: Response, next: NextFunction) => {
    try {
      const taskId = req.params.id
      const task = await getTask(taskId)
      if (!task) {
        throw new TaskError('Task not found', 'TASK_NOT_FOUND', 404)
      }
      // 原子条件更新：与终态写入互斥，抢不到说明任务已结束
      const cancelled = await cancelTask(taskId)
      if (!cancelled) {
        res.status(409).json({
          error: `任务已结束（当前状态：${task.status}），无法取消`,
          code: 'TASK_NOT_CANCELLABLE'
        })
        return
      }
      await appendTaskEvent(taskId, { type: 'task_cancelled', message: '任务已被用户取消' })
      res.json({ id: taskId, status: 'cancelled' })
    } catch (error) {
      next(error)
    }
  }
)

// GET /api/tasks?limit=&offset=&status= 列表
tasksRouter.get(
  '/',
  validate({ query: listTasksQuerySchema }),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { limit, offset, status } = getValidated<unknown, ListTasksQuery>(res).query
      const tasks = await listTasks(limit, offset, status as TaskStatus | undefined)
      const total = await countTasks(status as TaskStatus | undefined)
      res.json({ tasks, total, limit, offset })
    } catch (error) {
      next(error)
    }
  }
)

// GET /api/tasks/:id
tasksRouter.get(
  '/:id',
  withTaskId,
  async (req: TaskIdRequest, res: Response, next: NextFunction) => {
    try {
      const detail = await getTaskDetail(req.params.id)
      if (!detail.task) {
        throw new TaskError('Task not found', 'TASK_NOT_FOUND', 404)
      }
      res.json(detail)
    } catch (error) {
      next(error)
    }
  }
)

// GET /api/tasks/:id/report.md — 导出 Markdown 审查报告（REQ-13）
tasksRouter.get(
  '/:id/report.md',
  withTaskId,
  async (req: TaskIdRequest, res: Response, next: NextFunction) => {
    try {
      const detail = await getTaskDetail(req.params.id)
      if (!detail.task || !detail.report) {
        throw new TaskError('审查报告不存在', 'REPORT_NOT_FOUND', 404)
      }
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="report-${detail.task.id}.md"`)
      res.send(renderReportMarkdown(detail.task, detail.report.content))
    } catch (error) {
      next(error)
    }
  }
)

// GET /api/tasks/:id/report.sarif — 导出 SARIF 2.1.0（REQ-13）
tasksRouter.get(
  '/:id/report.sarif',
  withTaskId,
  async (req: TaskIdRequest, res: Response, next: NextFunction) => {
    try {
      const detail = await getTaskDetail(req.params.id)
      if (!detail.task || !detail.report) {
        throw new TaskError('审查报告不存在', 'REPORT_NOT_FOUND', 404)
      }
      res.setHeader('Content-Type', 'application/sarif+json')
      res.setHeader('Content-Disposition', `attachment; filename="report-${detail.task.id}.sarif"`)
      res.send(JSON.stringify(renderSarif(detail.task, detail.report.content), null, 2))
    } catch (error) {
      next(error)
    }
  }
)

// POST /api/tasks/:id/chat/stream - discuss a completed review with the assistant
tasksRouter.post(
  '/:id/chat/stream',
  validate({ params: taskIdParamsSchema, body: chatBodySchema }),
  async (req: TaskIdRequest, res: Response) => {
    const taskId = req.params.id
    const { message: userMessage } = req.body as ChatBody

    const task = await getTask(taskId)
    const report = await getReportByTask(taskId)
    if (!task || !report) {
      res.status(404).json({ error: 'Completed review not found', code: 'TASK_NOT_FOUND' })
      return
    }

    let reportContent: ReportContent
    try {
      reportContent = JSON.parse(report.content) as ReportContent
    } catch {
      res.status(500).json({ error: 'Review report is invalid', code: 'REPORT_INVALID' })
      return
    }

    const history = await getConversationMessages(taskId)
    await insertConversationMessage({
      id: uuidv4(),
      taskId,
      role: 'user',
      content: userMessage,
      createdAt: new Date().toISOString()
    })

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    startSseHeartbeat(res)

    const sendEvent = (event: string, data: unknown) => {
      if (res.writableEnded || res.destroyed) return
      res.write(`event: ${event}\n`)
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    try {
      const result = await streamAssistantReply(
        task,
        reportContent,
        history,
        userMessage,
        event => {
          sendEvent(event.type, event)
        }
      )
      await insertConversationMessage({
        id: uuidv4(),
        taskId,
        role: 'assistant',
        content: result.reply,
        createdAt: new Date().toISOString()
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Assistant request failed'
      sendEvent('error', { message })
    } finally {
      res.end()
    }
  }
)

// POST /api/tasks/:id/versions - accept an assistant-generated code version
tasksRouter.post(
  '/:id/versions',
  validate({ params: taskIdParamsSchema, body: versionBodySchema }),
  async (req: TaskIdRequest, res: Response, next: NextFunction) => {
    try {
      const taskId = req.params.id
      const { code, language, summary } = req.body as VersionBody
      const task = await getTask(taskId)
      if (!task) {
        throw new TaskError('Task not found', 'TASK_NOT_FOUND', 404)
      }
      const version = {
        id: uuidv4(),
        taskId,
        code,
        language,
        source: 'assistant',
        summary: summary ?? '',
        createdAt: new Date().toISOString()
      }
      await insertCodeVersion(version)
      res.status(201).json({ version })
    } catch (error) {
      next(error)
    }
  }
)

// POST /api/tasks/:id/guidelines - add a task/project-scoped coding standard
tasksRouter.post(
  '/:id/guidelines',
  validate({ params: taskIdParamsSchema, body: guidelineBodySchema }),
  async (req: TaskIdRequest, res: Response, next: NextFunction) => {
    try {
      const task = await getTask(req.params.id)
      if (!task) {
        throw new TaskError('Task not found', 'TASK_NOT_FOUND', 404)
      }
      const { fileName, content, language, dimension } = req.body as GuidelineBody
      try {
        const result = await addGuidelineDocument({
          scopeId: task.scopeId,
          fileName,
          content,
          language: language ?? '',
          dimension: dimension ?? ''
        })
        res.status(201).json({ ...result, scopeId: task.scopeId })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Guideline upload failed'
        res.status(400).json({ error: message, code: 'GUIDELINE_INVALID' })
      }
    } catch (error) {
      next(error)
    }
  }
)

// GET /api/tasks/:id/stream — 订阅任务事件流（回放 + 实时推送，不再触发执行）
tasksRouter.get('/:id/stream', withTaskId, async (req: TaskIdRequest, res: Response) => {
  const taskId = req.params.id

  // 续传位点：浏览器 EventSource 自动重连带 Last-Event-Id 头；本服务手动重连用 ?after=
  const lastEventId = req.headers['last-event-id']
  const afterRaw =
    (Array.isArray(lastEventId) ? lastEventId[0] : lastEventId) ||
    (typeof req.query.after === 'string' ? req.query.after : '')
  let lastSeq = parseInt(afterRaw, 10)
  if (!Number.isFinite(lastSeq) || lastSeq < 0) lastSeq = 0

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  startSseHeartbeat(res)

  function sendEvent(event: string, data: unknown, seq?: number): void {
    if (res.writableEnded || res.destroyed) return
    if (seq !== undefined) res.write(`id: ${seq}\n`)
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  let cleanedUp = false
  let unsubscribe: (() => void) | null = null
  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    unsubscribe?.()
  }
  req.on('close', cleanup)

  try {
    const detail = await getTaskDetail(taskId)
    if (!detail.task) {
      sendEvent('error', { message: 'Task not found' })
      res.end()
      return
    }

    // 连接期间先缓冲实时事件，回放完成后按 seq 过滤冲刷 —— 保证客户端按严格递增顺序消费，
    // 避免实时事件先于历史事件到达导致状态回退（如 reviewing 被回放的 orchestrating 覆盖）
    const buffered: StoredTaskEvent[] = []
    let replaying = true
    unsubscribe = subscribeTaskEvents(taskId, event => {
      if (replaying) {
        buffered.push(event)
        return
      }
      sendEvent(event.type, event, event.seq)
      if (isTerminalEvent(event)) {
        cleanup()
        res.end()
      }
    })

    // 连接快照（不占 seq）：任务可能尚在排队（pending），客户端据此渲染排队态
    sendEvent('task_state', {
      status: detail.task.status,
      attemptCount: detail.task.attemptCount ?? 0
    })

    let sawTerminal = false
    const REPLAY_PAGE = 500
    for (;;) {
      const batch = await getTaskEventsAfter(taskId, lastSeq, REPLAY_PAGE)
      for (const row of batch) {
        lastSeq = row.seq
        const payload = { ...(row.payload as unknown as ReviewEvent), type: row.type }
        sendEvent(row.type, payload, row.seq)
        if (isTerminalEvent(payload)) sawTerminal = true
      }
      if (batch.length < REPLAY_PAGE) break
    }

    // 终态兜底：DB 已终态但事件流缺终态事件（改造前的存量任务 / 终态事件落库失败）
    if (!sawTerminal) {
      const status = (await getTask(taskId))?.status
      if (status === 'completed') {
        sendEvent('task_completed', { taskId })
        sawTerminal = true
      } else if (status === 'failed') {
        sendEvent('error', { message: '任务执行失败' })
        sawTerminal = true
      } else if (status === 'cancelled') {
        sendEvent('task_cancelled', { taskId, message: '任务已被取消' })
        sawTerminal = true
      }
    }

    if (sawTerminal) {
      cleanup()
      res.end()
      return
    }

    replaying = false
    for (const event of buffered) {
      if (event.seq > lastSeq) {
        lastSeq = event.seq
        sendEvent(event.type, event, event.seq)
        if (isTerminalEvent(event)) {
          cleanup()
          res.end()
          return
        }
      }
    }
    // 非终态：保持连接，等待 LISTEN/NOTIFY 实时推送
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    sendEvent('error', { message })
    cleanup()
    res.end()
  }
})

// POST /api/tasks/:id/fix — 自动修复代码
tasksRouter.post(
  '/:id/fix',
  validate({ params: taskIdParamsSchema, body: fixBodySchema }),
  async (req: TaskIdRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params
      const { code: bodyCode, language: bodyLanguage } = req.body as FixBody

      // 1. 查询 task
      const task = await getTask(id)
      if (!task) {
        throw new TaskError('Task not found', 'TASK_NOT_FOUND', 404)
      }

      // 2. 获取代码和语言（body 优先，fallback 到 task）
      const code = bodyCode || task.codeSnippet
      const language = bodyLanguage || task.language

      if (!code) {
        throw new ValidationError('code 为必填项（任务无代码快照时必须在请求体提供）')
      }

      // 3. 从 report 获取 issues
      const report = await getReportByTask(id)
      if (!report) {
        throw new TaskError('该任务尚未完成审查，没有可用的 issues', 'REPORT_NOT_READY', 400)
      }

      let issues: Issue[] = []
      try {
        const reportContent = JSON.parse(report.content) as ReportContent
        issues = reportContent.issues || []
      } catch {
        throw new TaskError('解析审查报告失败', 'REPORT_INVALID', 500)
      }

      if (issues.length === 0) {
        throw new TaskError('审查报告中没有发现 issues，无需修复', 'NO_ISSUES_TO_FIX', 400)
      }

      // 4. 调用 applyFixes 工具生成修复代码
      const resultJson = await applyFixes.execute({
        code,
        language,
        issues: JSON.stringify(issues)
      })
      const result = JSON.parse(resultJson) as {
        fixedCode: string
        changes: FixChange[]
        error?: string
      }

      // 5. LLM 调用失败返回 502（上游模型服务问题）
      if (result.error) {
        throw new TaskError(result.error, 'FIX_FAILED', 502)
      }

      // 6. 返回修复结果
      res.json({
        originalCode: code,
        fixedCode: result.fixedCode,
        changes: result.changes
      })
    } catch (error) {
      next(error)
    }
  }
)

// POST /api/tasks/fetch-url — 抓取 URL 代码内容

const MAX_REDIRECTS = 3

async function fetchWithRedirectCheck(
  url: string,
  controller: AbortController,
  redirectCount: number
): Promise<globalThis.Response> {
  if (redirectCount > MAX_REDIRECTS) {
    throw new Error('重定向次数超过限制')
  }

  // 每次请求前校验目标 URL
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('重定向目标 URL 格式不正确')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('重定向目标使用了不支持的协议')
  }

  await resolveAndCheckIpSafe(parsed.hostname)

  const fetchRes = await fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      Accept: 'text/plain,text/html;q=0.5'
    },
    redirect: 'manual'
  })

  // 处理重定向
  const redirectStatuses = [301, 302, 303, 307, 308]
  if (redirectStatuses.includes(fetchRes.status)) {
    const location = fetchRes.headers.get('location')
    if (!location) {
      return fetchRes
    }
    const nextUrl = new URL(location, url).toString()
    return fetchWithRedirectCheck(nextUrl, controller, redirectCount + 1)
  }

  return fetchRes
}

tasksRouter.post(
  '/fetch-url',
  validate({ body: fetchUrlBodySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { url } = req.body as FetchUrlBody
      const parsed = new URL(url)

      // DNS 解析 + IP 校验（防止 SSRF 访问内网）
      try {
        await resolveAndCheckIpSafe(parsed.hostname)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'IP 校验失败'
        res.status(400).json({ error: message, code: 'URL_BLOCKED' })
        return
      }

      // 抓取内容，10 秒超时，手动处理重定向
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10_000)

      let fetchRes: globalThis.Response
      try {
        fetchRes = await fetchWithRedirectCheck(url, controller, 0)
      } catch (err) {
        clearTimeout(timeout)
        if (err instanceof Error && err.name === 'AbortError') {
          res.status(408).json({ error: '请求超时，请检查链接是否可访问', code: 'FETCH_TIMEOUT' })
          return
        }
        const message = err instanceof Error ? err.message : '网络请求失败'
        res.status(502).json({ error: message, code: 'FETCH_FAILED' })
        return
      }
      clearTimeout(timeout)

      if (!fetchRes.ok) {
        const reason =
          fetchRes.status >= 500
            ? `目标服务器异常（${fetchRes.status}）`
            : `目标服务器拒绝访问（${fetchRes.status}）`
        res.status(502).json({ error: reason, code: 'FETCH_UPSTREAM_ERROR' })
        return
      }

      // 检查 Content-Type，过滤明显非文本的响应
      const contentType = fetchRes.headers.get('content-type') || ''
      if (
        contentType.includes('application/octet-stream') ||
        contentType.includes('video/') ||
        contentType.includes('audio/') ||
        contentType.includes('image/')
      ) {
        res
          .status(400)
          .json({ error: '该链接不是文本文件，无法读取代码', code: 'CONTENT_NOT_TEXT' })
        return
      }

      // 读取内容，上限与单次审查代码上限一致（MAX_CODE_CHARS）
      const maxChars = getConfig().http.maxCodeChars
      const text = await fetchRes.text()
      if (text.length > maxChars) {
        res.status(400).json({
          error: `文件过大（超过 ${maxChars} 字符），请手动粘贴代码`,
          code: 'CONTENT_TOO_LARGE'
        })
        return
      }

      const lineCount = text.trimEnd().split('\n').length || 1

      res.json({
        content: text,
        byteSize: Buffer.byteLength(text, 'utf8'),
        lineCount
      })
    } catch (error) {
      next(error)
    }
  }
)

// ── 可观测性 Metrics 端点 ──

// GET /api/metrics
metricsRouter.get('/', async (_req: Request, res: Response) => {
  const tokenUsage = getTokenUsage()
  const agentLatency = getAgentLatency()
  const requestCount = getRequestCount()
  const uptime = process.uptime()

  // 任务级聚合来自 task_metrics 落库（跨进程真实数据）；进程内计数器保留兼容旧面板
  const since24h = new Date(Date.now() - 24 * 3600_000).toISOString()
  const since7d = new Date(Date.now() - 7 * 24 * 3600_000).toISOString()
  const [last24h, last7d, failures, reviewCache] = await Promise.all([
    aggregateTaskMetrics(since24h).catch(() => null),
    aggregateTaskMetrics(since7d).catch(() => null),
    recentTaskFailures(10).catch(() => []),
    getReviewCacheStats().catch(() => ({ entries: 0, totalHits: 0 }))
  ])

  res.json({
    tokenUsage: {
      promptTokens: tokenUsage.promptTokens,
      completionTokens: tokenUsage.completionTokens,
      totalTokens: tokenUsage.totalTokens
    },
    agentLatency: {
      preScan: agentLatency.preScan,
      orchestration: agentLatency.orchestration,
      reviewers: agentLatency.reviewers,
      reportGeneration: agentLatency.reportGeneration,
      total: agentLatency.total
    },
    requestCount,
    uptime: Math.round(uptime),
    tasks: {
      last24h,
      last7d,
      recentFailures: failures
    },
    reviewCache
  })
})

// POST /api/metrics/reset — 重置所有计数器
metricsRouter.post('/reset', (_req: Request, res: Response) => {
  resetTokenUsage()
  resetAgentLatency()
  res.json({ message: '计数器已重置' })
})

export { tasksRouter, metricsRouter }
