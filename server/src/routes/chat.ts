import { Router, type Request, type Response } from 'express'
import {
  getReportByTask,
  getConversationMessages,
  getTask,
  insertConversationMessage
} from '../db/queries'
import type { ReportContent } from '../../../shared/types'
import { v4 as uuidv4 } from 'uuid'
import { validate } from '../validation/middleware'
import { chatBodySchema, taskIdParamsSchema, type ChatBody } from '../validation/schemas'
import { streamAssistantReply } from '../services/assistantService'
import { startSseHeartbeat, writeSseEvent, writeSseHeaders } from './sse'

/** 审查对话路由（POST /api/tasks/:id/chat/stream） */
export const chatRouter = Router()

/** 带路径参数的路由请求类型（express 5 起 params 值可能为数组，需显式收窄为 string） */
type TaskIdRequest = Request<{ id: string }>

// POST /api/tasks/:id/chat/stream - discuss a completed review with the assistant
chatRouter.post(
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

    writeSseHeaders(res)
    startSseHeartbeat(res)

    const sendEvent = (event: string, data: unknown) => {
      writeSseEvent(res, event, data)
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
