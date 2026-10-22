import { v4 as uuidv4 } from 'uuid'
import { getConfig } from '../config'
import { QueueUnavailableError } from '../errors'
import { createLogger } from '../logger'
import type {
  Task,
  Agent,
  Message,
  ReportContent,
  AgentRole,
  ReviewConfig,
  TaskSource
} from '../../../shared/types'
import {
  insertTask,
  updateTaskStatus,
  getTask,
  insertAgent,
  insertReport,
  getReportByTask,
  getMessagesByTask,
  getAgentsByTask,
  linkCodeVersionToReview,
  markTaskFailed
} from '../db/queries'
import { appendTaskEvent } from './eventService'

const logger = createLogger('task-service')

/** 创建审查任务的输入（取代原先 6 个位置参数） */
export interface CreateTaskInput {
  code: string
  language: string
  title?: string
  scopeId?: string
  reviewConfig?: ReviewConfig
  source?: TaskSource
}

/** 提交审查任务的输入：在创建任务之外，可关联一个由助手生成的代码版本 */
export interface SubmitReviewTaskInput extends CreateTaskInput {
  sourceVersionId?: string
}

/** 把任务投递到队列（生产环境为 RabbitMQ 生产者，单测注入 mock） */
export type PublishTask = (taskId: string) => Promise<void>

async function createTask(input: CreateTaskInput): Promise<Task> {
  const id = uuidv4()
  const task: Task = {
    id,
    title: input.title || `Code Review - ${new Date().toLocaleString()}`,
    codeSnippet: input.code,
    language: input.language,
    scopeId: input.scopeId || id,
    status: 'pending',
    createdAt: new Date().toISOString()
  }
  // 仅在有值时写入，避免把 undefined 变成 JSON 里的 null 字段
  if (input.reviewConfig) task.reviewConfig = input.reviewConfig
  if (input.source) task.source = input.source

  await insertTask(task)
  return task
}

async function createAgentsForTask(taskId: string): Promise<void> {
  const roles: AgentRole[] = ['orchestrator', 'security', 'performance', 'style', 'logic']
  const modelName = getConfig().llm.model

  for (const role of roles) {
    const agent: Agent = {
      id: `${role}-${taskId}`,
      taskId,
      role,
      status: 'idle',
      modelName,
      createdAt: new Date().toISOString()
    }
    await insertAgent(agent)
  }
}

/**
 * 提交一个审查任务：创建任务 → 创建 agents → 关联代码版本 → 写 task_queued 事件 → 入队。
 *
 * 所有入口（`POST /api/tasks`、GitHub Webhook）都必须走这里，保证任务在库内的形态一致：
 * messages / tool_calls 外键引用 agents，缺少 agents 行会导致审查对话无法落库。
 *
 * 入队失败时任务标记为 failed 并写入 error 事件，然后抛出 {@link QueueUnavailableError}，
 * 由调用方决定如何响应（HTTP 路由映射为 502）。
 */
async function submitReviewTask(
  input: SubmitReviewTaskInput,
  publishTask: PublishTask
): Promise<Task> {
  const { sourceVersionId, ...createInput } = input
  const task = await createTask(createInput)
  await createAgentsForTask(task.id)
  if (sourceVersionId) await linkCodeVersionToReview(sourceVersionId, task.id)

  await appendTaskEvent(task.id, { type: 'task_queued', message: '任务已创建，进入审查队列' })
  try {
    await publishTask(task.id)
  } catch (error) {
    // publisher confirm 失败说明 broker 未收到消息：任务标记失败并明确告知调用方
    logger.error('任务入队失败', { taskId: task.id, error })
    await markTaskFailed(task.id)
    await appendTaskEvent(task.id, {
      type: 'error',
      message: '消息队列暂不可用，任务未能入队'
    }).catch(() => undefined)
    throw new QueueUnavailableError()
  }
  return task
}

async function saveReport(
  taskId: string,
  reportContent: ReportContent,
  score: number
): Promise<void> {
  const report = {
    id: `report-${taskId}`,
    taskId,
    content: JSON.stringify(reportContent),
    score,
    createdAt: new Date().toISOString()
  }
  await insertReport(report)
}

async function getTaskDetail(taskId: string): Promise<{
  task: Task | null
  agents: Agent[]
  messages: Message[]
  report: { content: ReportContent; score: number } | null
}> {
  const task = await getTask(taskId)
  const agents = await getAgentsByTask(taskId)
  const messages = await getMessagesByTask(taskId)
  const report = await getReportByTask(taskId)

  let reportData = null
  if (report) {
    reportData = {
      content: JSON.parse(report.content) as ReportContent,
      score: report.score
    }
  }

  return { task, agents, messages, report: reportData }
}

export {
  createTask,
  createAgentsForTask,
  submitReviewTask,
  saveReport,
  getTaskDetail,
  updateTaskStatus
}
