import type { AppConfig } from '../config'
import { RabbitSession } from './rabbit'
import type { TaskProducer } from './producer'
import { findStaleRunningTasks, findLostPendingTasks } from '../db/queries'
import { appendTaskEvent } from '../services/eventService'
import { createLogger } from '../logger'

const logger = createLogger('sweeper')

const SWEEP_INTERVAL_MS = 60_000
/** 创建后超过该时长仍 pending，视为“落库成功但消息可能丢失”，重新发布补偿 */
const LOST_PENDING_AFTER_MS = 5 * 60_000

export interface Sweeper {
  stop(): Promise<void>
}

/**
 * 兜底对账循环（at-least-once 语义的最后一块拼图）：
 *
 * 1. 心跳超时的 orchestrating 任务重置回 pending 并重新入队。
 *    这是 worker 崩溃恢复的唯一路径——不依赖消息 redelivered 标记立即重跑，
 *    宁可慢 1~2 分钟回收，也避免“原 worker 还活着导致双跑”烧双份 LLM token。
 *    heartbeat_at 为 NULL 的存量悬挂任务（改造前遗留）一并回收。
 *
 * 2. 长时间 pending 的任务重新发布，覆盖“任务落库成功、publish 失败/消息丢失”的窗口。
 *    重复消息是无害的：claim 抢占是原子的，后到的重复消息只会被幂等吸收。
 */
export function startSweeper(
  session: RabbitSession,
  producer: TaskProducer,
  config: AppConfig
): Sweeper {
  let sweeping: Promise<void> = Promise.resolve()

  async function sweep(): Promise<void> {
    if (!session.isConnected()) return

    const staleBefore = new Date(Date.now() - config.heartbeat.staleMs).toISOString()
    for (const taskId of await findStaleRunningTasks(staleBefore)) {
      logger.warn('任务心跳超时，重置回队列', { taskId })
      await appendTaskEvent(taskId, {
        type: 'task_retrying',
        message: '执行进程心跳丢失，任务已重新入队'
      }).catch(() => undefined)
      await producer.publishTask(taskId).catch(error => {
        logger.error('任务重新入队失败', { taskId, error })
      })
    }

    const lostBefore = new Date(Date.now() - LOST_PENDING_AFTER_MS).toISOString()
    for (const taskId of await findLostPendingTasks(lostBefore)) {
      logger.warn('任务长时间 pending，补偿性重新发布', { taskId })
      await producer.publishTask(taskId).catch(error => {
        logger.error('任务补偿发布失败', { taskId, error })
      })
    }
  }

  const timer = setInterval(() => {
    sweeping = sweeping.then(sweep).catch(error => {
      logger.error('扫描失败', { error })
    })
  }, SWEEP_INTERVAL_MS)
  timer.unref?.()

  return {
    async stop(): Promise<void> {
      clearInterval(timer)
      await sweeping.catch(() => undefined)
    }
  }
}
