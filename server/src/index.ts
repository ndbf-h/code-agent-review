import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { loadConfig } from './config'
import { initDb } from './db/schema'
import { closeDb } from './db/connection'
import { registerAllTools } from './tools/index'
import { createRateLimiter } from './middleware/rateLimiter'
import { llmClient } from './agent/llm-client'
import { tasksRouter, metricsRouter, setTaskProducer } from './routes/tasks'
import { RabbitSession } from './queue/rabbit'
import { createTaskProducer } from './queue/producer'
import { startSweeper } from './queue/sweeper'
import { startEventSubscriber, stopEventSubscriber } from './services/eventService'
import { initTracing, shutdownTracing } from './observability/tracing'
import { AppError } from './errors'
import { loadGuidelinesFromDatabase } from './services/knowledgeService'
import { mountMcpEndpoint } from './mcp/server'
import { mountExternalMcpTools } from './mcp/client'

async function main() {
  // 启动时校验配置
  const config = loadConfig()
  const app = express()

  // RabbitMQ 会话：API 进程仅作生产者（发布任务），消费在独立 worker 进程
  const rabbit = new RabbitSession(config.rabbitmqUrl, 'api', config.taskRetry.delayMs)
  setTaskProducer(createTaskProducer(rabbit))

  app.use(cors())
  // MCP 端点必须在 express.json() 之前挂载（自管 body 解析）；工具清单请求时惰性读取 registry
  mountMcpEndpoint(app)
  app.use(express.json())

  // 全局限流：100 req/min
  const globalLimiter = createRateLimiter(100, 60_000)
  app.use(globalLimiter)

  await initDb()
  console.log('[db] Database initialized')
  await loadGuidelinesFromDatabase()

  registerAllTools()
  void mountExternalMcpTools()

  // 任务路由限流：10 req/min
  const reviewLimiter = createRateLimiter(10, 60_000)

  app.use('/api/tasks', reviewLimiter, tasksRouter)

  // 可观测性 Metrics 路由
  app.use('/api/metrics', metricsRouter)

  // 增强健康检查
  app.get('/api/health', async (_req, res) => {
    const llmHealthy = await llmClient.healthCheck().catch(() => false)
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      db: 'connected',
      llm: llmHealthy ? 'healthy' : 'unhealthy',
      rabbitmq: rabbit.isConnected() ? 'connected' : 'disconnected'
    })
  })

  // 全局错误处理中间件（必须在路由之后注册）
  // Express 4 类型不原生支持 4-参数错误处理签名，需要类型断言
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json(err.toJSON())
      return
    }
    console.error('[unhandled]', err)
    res.status(500).json({ error: '内部服务器错误', code: 'INTERNAL_ERROR' })
  })

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
    console.log(`[server] Running on http://localhost:${config.port}`)
  })

  let shuttingDown = false
  const shutdown = (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[server] 收到 ${signal}，开始优雅关闭`)
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

main().catch(console.error)
