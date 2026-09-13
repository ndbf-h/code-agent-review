import amqplib, { type ChannelModel, type Channel, type ConfirmChannel } from 'amqplib'

/**
 * 任务流拓扑：
 *
 *   publish ──► exchange review.task (direct, rk=ready)
 *                    │ 绑定
 *                    ▼
 *              queue review.task.ready ◄────── worker 消费（prefetch = 并发上限）
 *                    │ 消费失败（重试额度未耗尽）
 *                    ▼
 *              queue review.task.retry（x-message-ttl = 延迟毫秒数）
 *                    │ TTL 到期，死信路由回主交换机 rk=ready —— 实现“延迟重投”
 *                    ▼
 *              （重新回到 ready 队列）
 *
 *   ready 队列上被 nack(requeue=false) / 过期的消息 ──► exchange review.task.dlx
 *                                                        │ 绑定 rk=dead
 *                                                        ▼
 *                                                  queue review.task.dlq（人工审计）
 */
export const TASK_EXCHANGE = 'review.task'
export const TASK_ROUTING_KEY = 'ready'
export const TASK_READY_QUEUE = 'review.task.ready'
export const TASK_RETRY_QUEUE = 'review.task.retry'
export const DLX_EXCHANGE = 'review.task.dlx'
export const TASK_DLQ_QUEUE = 'review.task.dlq'

const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30_000

/**
 * 声明队列拓扑（幂等，可重复调用）。
 * 注意：RabbitMQ 的队列参数在首次创建后不可变更 —— 调整 TASK_RETRY_DELAY_MS
 * 需先删除 review.task.retry 队列（管理 UI 或 rabbitmqctl delete_queue），
 * 否则 assertQueue 会因参数不一致触发 406 PRECONDITION_FAILED 并关闭通道。
 */
export async function assertTopology(channel: Channel, retryDelayMs: number): Promise<void> {
  await channel.assertExchange(TASK_EXCHANGE, 'direct', { durable: true })
  await channel.assertExchange(DLX_EXCHANGE, 'direct', { durable: true })

  await channel.assertQueue(TASK_READY_QUEUE, {
    durable: true,
    arguments: {
      // ready 队列里被拒绝/过期的消息转入死信交换机，最终落到 DLQ
      'x-dead-letter-exchange': DLX_EXCHANGE,
      'x-dead-letter-routing-key': 'dead'
    }
  })

  await channel.assertQueue(TASK_RETRY_QUEUE, {
    durable: true,
    arguments: {
      // 没有消费者：消息仅在此停留等 TTL 到期，然后经死信路由回主交换机重新投递
      'x-message-ttl': retryDelayMs,
      'x-dead-letter-exchange': TASK_EXCHANGE,
      'x-dead-letter-routing-key': TASK_ROUTING_KEY
    }
  })

  await channel.assertQueue(TASK_DLQ_QUEUE, { durable: true })

  await channel.bindQueue(TASK_READY_QUEUE, TASK_EXCHANGE, TASK_ROUTING_KEY)
  await channel.bindQueue(TASK_DLQ_QUEUE, DLX_EXCHANGE, 'dead')
}

type ReadyCallback = (connection: ChannelModel) => Promise<void>

/**
 * RabbitMQ 连接会话：封装断线重连，每次（重）连成功后自动重建拓扑、
 * 重放 onReady 回调（worker 借此重新注册消费者）。
 * start() 首次连接成功后 resolve；broker 缺席时无限指数退避，不阻塞进程启动。
 */
export class RabbitSession {
  private connection: ChannelModel | null = null
  private confirmChannel: ConfirmChannel | null = null
  private stopped = false
  private readonly readyCallbacks: ReadyCallback[] = []

  constructor(
    private readonly url: string,
    private readonly label: string,
    private readonly retryDelayMs: number
  ) {}

  start(): Promise<void> {
    return this.connectLoop()
  }

  isConnected(): boolean {
    return this.connection !== null
  }

  /** 注册（重）连后的回调；必须在 start() 之前调用 */
  onReady(callback: ReadyCallback): void {
    this.readyCallbacks.push(callback)
  }

  /** 获取发布者确认通道；连接断开时抛错，由调用方降级（如 POST 返回 502） */
  async getConfirmChannel(): Promise<ConfirmChannel> {
    if (!this.connection) throw new Error('RabbitMQ 未连接')
    if (!this.confirmChannel) {
      this.confirmChannel = await this.connection.createConfirmChannel()
    }
    return this.confirmChannel
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.connection) {
      try {
        await this.connection.close()
      } catch {
        // 连接可能已断开；关闭连接会让 broker 重投所有未 ack 消息
      }
      this.connection = null
    }
    this.confirmChannel = null
  }

  private async connectLoop(): Promise<void> {
    let backoff = INITIAL_BACKOFF_MS
    while (!this.stopped) {
      try {
        const connection = await amqplib.connect(this.url)
        if (this.stopped) {
          try { await connection.close() } catch { /* 已停止，直接丢弃连接 */ }
          return
        }
        this.connection = connection
        this.confirmChannel = null
        backoff = INITIAL_BACKOFF_MS
        console.log(`[rabbit:${this.label}] 已连接 ${maskUrl(this.url)}`)

        const channel = await connection.createChannel()
        await assertTopology(channel, this.retryDelayMs)
        await channel.close()

        connection.on('error', (err: Error) => {
          console.error(`[rabbit:${this.label}] 连接错误: ${err.message}`)
        })
        // close 在 error 之后触发，是唯一的“连接已死”可靠信号
        connection.on('close', () => {
          if (this.stopped) return
          console.warn(`[rabbit:${this.label}] 连接断开，开始自动重连`)
          this.connection = null
          this.confirmChannel = null
          void this.connectLoop()
        })

        for (const callback of this.readyCallbacks) {
          try {
            await callback(connection)
          } catch (err) {
            console.error(`[rabbit:${this.label}] onReady 回调失败: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
        return
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[rabbit:${this.label}] 连接失败（${message}），${Math.round(backoff / 1000)}s 后重试`)
        await new Promise(resolve => setTimeout(resolve, backoff))
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
      }
    }
  }
}

function maskUrl(url: string): string {
  return url.replace(/\/\/.*@/, '//***@')
}
