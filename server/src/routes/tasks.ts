import { Router, type Request, type Response, type NextFunction } from 'express'
import { ValidationError, TaskError } from '../errors'
import { submitReviewTask, getTaskDetail } from '../services/taskService'
import {
  listTasks,
  countTasks,
  getTask,
  getReportByTask,
  insertCodeVersion,
  cancelTask
} from '../db/queries'
import { applyFixes } from '../tools/fix'
import type { FixChange } from '../tools/fix'
import type { Issue, ReportContent, TaskStatus } from '../../../shared/types'
import { v4 as uuidv4 } from 'uuid'
import { appendTaskEvent } from '../services/eventService'
import type { TaskProducer } from '../queue/producer'
import { addGuidelineDocument } from '../services/knowledgeService'
import { validate, getValidated } from '../validation/middleware'
import { renderReportMarkdown } from '../export/markdown'
import { renderSarif } from '../export/sarif'
import {
  taskIdParamsSchema,
  createTaskBodySchema,
  listTasksQuerySchema,
  versionBodySchema,
  guidelineBodySchema,
  fixBodySchema,
  type CreateTaskBody,
  type ListTasksQuery,
  type VersionBody,
  type GuidelineBody,
  type FixBody
} from '../validation/schemas'
import { streamRouter } from './stream'
import { chatRouter } from './chat'
import { fetchUrlRouter } from './fetch-url'

/** 任务 CRUD 与报告导出路由（挂载于 /api/tasks） */
export const tasksRouter = Router()

// 职责单一的子路由：事件流、审查对话、URL 抓取（指标在 ./metrics 独立挂载）
tasksRouter.use(streamRouter)
tasksRouter.use(chatRouter)
tasksRouter.use(fetchUrlRouter)

/** 带路径参数的路由请求类型（express 5 起 params 值可能为数组，需显式收窄为 string） */
type TaskIdRequest = Request<{ id: string }>

/** 所有 /:id 路径参数统一要求 UUID */
const withTaskId = validate({ params: taskIdParamsSchema })

let taskProducer: TaskProducer | null = null

/** 注入任务队列发布器（index.ts 启动时调用，路由随后才能入队任务） */
export function setTaskProducer(producer: TaskProducer): void {
  taskProducer = producer
}

function requireProducer(): TaskProducer {
  if (!taskProducer) throw new Error('任务队列发布器尚未初始化')
  return taskProducer
}

/** 通过已注入的生产者入队（Webhook 等其它入口复用，保证与本路由走同一个生产者） */
export function publishViaTaskProducer(taskId: string): Promise<void> {
  return requireProducer().publishTask(taskId)
}

// POST /api/tasks
tasksRouter.post(
  '/',
  validate({ body: createTaskBodySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code, language, title, scopeId, sourceVersionId, reviewConfig } =
        req.body as CreateTaskBody

      // 入队失败抛 QueueUnavailableError（502 QUEUE_UNAVAILABLE），交由全局错误处理并附带 requestId
      const task = await submitReviewTask(
        { code, language, title, scopeId, reviewConfig, sourceVersionId },
        publishViaTaskProducer
      )
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
