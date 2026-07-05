import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { loadConfig } from './config'
import { initDb } from './db/schema'
import { registerAllTools } from './tools/index'
import { createRateLimiter } from './middleware/rateLimiter'
import { llmClient } from './agent/llm-client'
import { tasksRouter } from './routes/tasks'
import { AppError } from './errors'

async function main() {
  // 启动时校验配置
  const config = loadConfig()
  const app = express()

  app.use(cors())
  app.use(express.json())

  // 全局限流：100 req/min
  const globalLimiter = createRateLimiter(100, 60_000)
  app.use(globalLimiter)

  initDb()
  console.log('[db] Database initialized')

  registerAllTools()

  // 任务路由限流：10 req/min
  const reviewLimiter = createRateLimiter(10, 60_000)

  // 初始化并发任务追踪
  app.locals.activeTaskCount = 0
  app.locals.maxConcurrentTasks = config.maxConcurrentTasks

  app.use('/api/tasks', reviewLimiter, tasksRouter)

  // 增强健康检查
  app.get('/api/health', async (_req, res) => {
    const llmHealthy = await llmClient.healthCheck().catch(() => false)
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      db: 'connected',
      llm: llmHealthy ? 'healthy' : 'unhealthy',
      activeTasks: app.locals.activeTaskCount as number
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

  app.listen(config.port, () => {
    console.log(`[server] Running on http://localhost:${config.port}`)
  })
}

main().catch(console.error)
