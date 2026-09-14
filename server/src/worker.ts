import 'dotenv/config'
import { loadConfig } from './config'
import { initDb } from './db/schema'
import { closeDb } from './db/connection'
import { registerAllTools } from './tools/index'
import { loadGuidelinesFromDatabase } from './services/knowledgeService'
import { RabbitSession } from './queue/rabbit'
import { createTaskProducer } from './queue/producer'
import { startTaskConsumer } from './queue/consumer'
import { startSweeper } from './queue/sweeper'
import { initTracing, shutdownTracing } from './observability/tracing'
import { mountExternalMcpTools } from './mcp/client'
import { createLogger } from './logger'

const logger = createLogger('worker')

/**
 * Worker 独立进程入口：只消费 RabbitMQ 任务并执行审查，不提供 HTTP 服务。
 * 与 API 进程通过 RabbitMQ（任务流）和 PostgreSQL（状态 + 事件日志）协作。
 */
async function main(): Promise<void> {
  const config = loadConfig()

  await initDb()
  logger.info('Database initialized')
  await loadGuidelinesFromDatabase()
  registerAllTools()
  void mountExternalMcpTools()
  initTracing()

  const session = new RabbitSession(config.rabbitmqUrl, 'worker', config.taskRetry.delayMs)
  const producer = createTaskProducer(session)
  const consumer = startTaskConsumer(session, producer, config)
  const sweeper = startSweeper(session, producer, config)

  await session.start()

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info(`收到 ${signal}，开始优雅关闭`)
    try {
      await sweeper.stop()
      await consumer.stop(25_000)
      await session.stop()
      await shutdownTracing()
      await closeDb()
    } finally {
      process.exit(0)
    }
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  logger.info('已启动，等待任务...', { env: config.env, prefetch: config.maxConcurrentTasks })
}

main().catch(error => {
  logger.error('启动失败', error)
  process.exit(1)
})
