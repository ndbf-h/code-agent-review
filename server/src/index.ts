import 'dotenv/config'
import { loadConfig } from './config'
import { initDb } from './db/schema'
import { getDb, closeDb } from './db/connection'
import { registerAllTools } from './tools/index'
import { llmClient } from './agent/llm-client'
import { setTaskProducer } from './routes/tasks'
import { RabbitSession } from './queue/rabbit'
import { createTaskProducer } from './queue/producer'
import { startSweeper } from './queue/sweeper'
import { startEventSubscriber, stopEventSubscriber } from './services/eventService'
import { initTracing, shutdownTracing } from './observability/tracing'
import { loadGuidelinesFromDatabase } from './services/knowledgeService'
import { mountExternalMcpTools } from './mcp/client'
import { createApp } from './app'
import { createLogger } from './logger'

const logger = createLogger('server')

async function main() {
  // 启动时校验配置（失败会列出全部问题字段并退出）
  const config = loadConfig()

  // RabbitMQ 会话：API 进程仅作生产者（发布任务），消费在独立 worker 进程
  const rabbit = new RabbitSession(config.rabbitmqUrl, 'api', config.taskRetry.delayMs)
  const producer = createTaskProducer(rabbit)
  setTaskProducer(producer)

  const app = createApp({
    config,
    health: {
      checkDb: () =>
        getDb()
          .query('SELECT 1')
          .then(() => true),
      isRabbitConnected: () => rabbit.isConnected(),
      checkLlm: () => llmClient.healthCheck()
    },
    // REQ-15：Webhook 创建的任务需要入队，复用同一个生产者
    publishTask: taskId => producer.publishTask(taskId)
  })

  await initDb()
  logger.info('Database initialized')
  await loadGuidelinesFromDatabase()

  registerAllTools()
  void mountExternalMcpTools()

  // 事件实时扇出依赖 PG LISTEN/NOTIFY（worker 落库事件 → 本进程推给 SSE 连接）
  await startEventSubscriber()

  // Langfuse 可选启用（未配置密钥时为纯计数模式）
  initTracing()

  // Rabbit 连接在后台建立（失败自动退避重连），不阻塞 HTTP 服务启动；
  // broker 缺席期间创建任务会返回 502 QUEUE_UNAVAILABLE
  void rabbit.start()

  // 兜底对账也在 API 进程跑一份：worker 全部下线的窗口期仍能回收心跳超时任务并
  // 补发丢失消息（sweeper 全部操作幂等，与 worker 侧并存是安全的）
  const sweeper = startSweeper(rabbit, createTaskProducer(rabbit), config)

  const server = app.listen(config.port, () => {
    logger.info(`Running on http://localhost:${config.port}`, { env: config.env })
  })

  let shuttingDown = false
  const shutdown = (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info(`收到 ${signal}，开始优雅关闭`)
    server.close(async () => {
      try {
        await sweeper.stop()
        await stopEventSubscriber()
        await rabbit.stop()
        await shutdownTracing()
        await closeDb()
      } finally {
        process.exit(0)
      }
    })
    // 兜底：10s 后强制退出，避免残留长连接卡住关闭流程
    setTimeout(() => process.exit(0), 10_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch(error => {
  logger.error('启动失败', error)
  process.exit(1)
})
