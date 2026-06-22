import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { initDb } from './db/schema'
import { registerAllTools } from './tools/index'
import { tasksRouter } from './routes/tasks'

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

  app.listen(PORT, () => {
    console.log(`[server] Running on http://localhost:${PORT}`)
  })
}

main().catch(console.error)
