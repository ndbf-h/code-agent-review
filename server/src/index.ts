import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { initDb } from './db/schema'
import { registerAllTools } from './tools/index'
import { tasksRouter } from './routes/tasks'
import { AppError } from './errors'

async function main() {
  const app = express()
  const PORT = process.env.PORT || 3001

  app.use(cors())
  app.use(express.json())

  await initDb()
  console.log('[db] Database initialized')

  registerAllTools()

  app.use('/api/tasks', tasksRouter)

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
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

  app.listen(PORT, () => {
    console.log(`[server] Running on http://localhost:${PORT}`)
  })
}

main().catch(console.error)
