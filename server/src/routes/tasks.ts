import { Router, type Request, type Response } from 'express'
import { createTask, createAgentsForTask, saveReport, getTaskDetail, updateTaskStatus } from '../services/taskService'
import { runReviewTask } from '../agent/orchestrator'
import type { ReviewEvent } from '../agent/orchestrator'

const tasksRouter = Router()

// POST /api/tasks
tasksRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { code, language, title } = req.body

    if (!code || !language) {
      res.status(400).json({ error: 'code and language are required' })
      return
    }

    const task = await createTask(code, language, title)
    await createAgentsForTask(task.id)

    res.status(201).json(task)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// GET /api/tasks/:id
tasksRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const detail = await getTaskDetail(req.params.id)
    if (!detail.task) {
      res.status(404).json({ error: 'Task not found' })
      return
    }
    res.json(detail)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// GET /api/tasks/:id/stream
tasksRouter.get('/:id/stream', async (req: Request, res: Response) => {
  const taskId = req.params.id

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  })

  function sendEvent(event: string, data: unknown): void {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  const detail = await getTaskDetail(taskId)
  if (!detail.task) {
    sendEvent('error', { message: 'Task not found' })
    res.end()
    return
  }

  await updateTaskStatus(taskId, 'orchestrating')

  try {
    const reportContent = await runReviewTask(
      taskId,
      detail.task.codeSnippet,
      detail.task.language,
      (event: ReviewEvent) => {
        sendEvent(event.type, event)
      }
    )

    const score = reportContent.agentResults
      ? Math.round(
        Object.values(reportContent.agentResults).reduce(
          (sum: number, r: { score: number }) => sum + r.score, 0
        ) / Math.max(Object.values(reportContent.agentResults).length, 1)
      )
      : 0

    await saveReport(taskId, reportContent, score)
    await updateTaskStatus(taskId, 'completed')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    sendEvent('error', { message })
    await updateTaskStatus(taskId, 'failed')
  }

  res.end()
})

export { tasksRouter }
