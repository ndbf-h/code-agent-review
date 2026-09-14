import type { ConfirmChannel } from 'amqplib'
import {
  TASK_EXCHANGE,
  TASK_ROUTING_KEY,
  TASK_RETRY_QUEUE,
  DLX_EXCHANGE,
  type RabbitSession
} from './rabbit'

export interface TaskProducer {
  /** 新任务入队（主交换机 → ready 队列） */
  publishTask(taskId: string): Promise<void>
  /** 失败任务转入 TTL 延迟队列，到期后自动重回 ready 队列 */
  sendToRetry(taskId: string): Promise<void>
  /** 重试耗尽的任务归档到死信队列（人工审计用，不驱动任何流程） */
  sendToDead(taskId: string, reason: string): Promise<void>
}

export function createTaskProducer(session: RabbitSession): TaskProducer {
  /**
   * 发布并等待 broker 确认（publisher confirm）：
   * 确认到达意味着消息已落入 broker（配合 persistent 消息 + durable 队列，
   * broker 重启也不丢），否则向调用方抛错。
   */
  async function publishConfirmed(
    channel: ConfirmChannel,
    exchange: string,
    routingKey: string,
    body: unknown
  ): Promise<void> {
    channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(body)), {
      persistent: true,
      contentType: 'application/json'
    })
    await channel.waitForConfirms()
  }

  return {
    async publishTask(taskId: string): Promise<void> {
      const channel = await session.getConfirmChannel()
      await publishConfirmed(channel, TASK_EXCHANGE, TASK_ROUTING_KEY, { taskId })
    },
    async sendToRetry(taskId: string): Promise<void> {
      const channel = await session.getConfirmChannel()
      // 经默认交换机（exchange 为空串）按队列名直投 TTL 队列
      await publishConfirmed(channel, '', TASK_RETRY_QUEUE, { taskId })
    },
    async sendToDead(taskId: string, reason: string): Promise<void> {
      const channel = await session.getConfirmChannel()
      await publishConfirmed(channel, DLX_EXCHANGE, 'dead', { taskId, reason })
    }
  }
}
