import { Router, type Request, type Response } from 'express'
import { getTaskEventsAfter, getTask } from '../db/queries'
import { getTaskDetail } from '../services/taskService'
import type { ReviewEvent } from '../agent/orchestrator'
import { subscribeTaskEvents, type StoredTaskEvent } from '../services/eventService'
import { validate } from '../validation/middleware'
import { taskIdParamsSchema } from '../validation/schemas'
import { isTerminalEvent, startSseHeartbeat, writeSseEvent, writeSseHeaders } from './sse'

/** 订阅任务事件流路由（GET /api/tasks/:id/stream） */
export const streamRouter = Router()

/** 带路径参数的路由请求类型（express 5 起 params 值可能为数组，需显式收窄为 string） */
type TaskIdRequest = Request<{ id: string }>

/** 所有 /:id 路径参数统一要求 UUID */
const withTaskId = validate({ params: taskIdParamsSchema })

// GET /api/tasks/:id/stream — 订阅任务事件流（回放 + 实时推送，不再触发执行）
streamRouter.get('/:id/stream', withTaskId, async (req: TaskIdRequest, res: Response) => {
  const taskId = req.params.id

  // 续传位点：浏览器 EventSource 自动重连带 Last-Event-Id 头；本服务手动重连用 ?after=
  const lastEventId = req.headers['last-event-id']
  const afterRaw =
    (Array.isArray(lastEventId) ? lastEventId[0] : lastEventId) ||
    (typeof req.query.after === 'string' ? req.query.after : '')
  let lastSeq = parseInt(afterRaw, 10)
  if (!Number.isFinite(lastSeq) || lastSeq < 0) lastSeq = 0

  writeSseHeaders(res)
  startSseHeartbeat(res)

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
      writeSseEvent(res, 'error', { message: 'Task not found' })
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
      writeSseEvent(res, event.type, event, event.seq)
      if (isTerminalEvent(event)) {
        cleanup()
        res.end()
      }
    })

    // 连接快照（不占 seq）：任务可能尚在排队（pending），客户端据此渲染排队态
    writeSseEvent(res, 'task_state', {
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
        writeSseEvent(res, row.type, payload, row.seq)
        if (isTerminalEvent(payload)) sawTerminal = true
      }
      if (batch.length < REPLAY_PAGE) break
    }

    // 终态兜底：DB 已终态但事件流缺终态事件（改造前的存量任务 / 终态事件落库失败）
    if (!sawTerminal) {
      const status = (await getTask(taskId))?.status
      if (status === 'completed') {
        writeSseEvent(res, 'task_completed', { taskId })
        sawTerminal = true
      } else if (status === 'failed') {
        writeSseEvent(res, 'error', { message: '任务执行失败' })
        sawTerminal = true
      } else if (status === 'cancelled') {
        writeSseEvent(res, 'task_cancelled', { taskId, message: '任务已被取消' })
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
        writeSseEvent(res, event.type, event, event.seq)
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
    writeSseEvent(res, 'error', { message })
    cleanup()
    res.end()
  }
})
