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

// POST /api/tasks/fetch-url — 抓取 URL 代码内容
tasksRouter.post('/fetch-url', async (req: Request, res: Response) => {
  try {
    const { url } = req.body

    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: '请提供有效的 URL' })
      return
    }

    // 协议校验
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      res.status(400).json({ error: 'URL 格式不正确' })
      return
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      res.status(400).json({ error: '仅支持 http/https 链接' })
      return
    }

    // 抓取内容，10 秒超时
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    let fetchRes: globalThis.Response
    try {
      fetchRes = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'text/plain,text/html;q=0.5'
        },
        redirect: 'follow'
      })
    } catch (err) {
      clearTimeout(timeout)
      if (err instanceof Error && err.name === 'AbortError') {
        res.status(408).json({ error: '请求超时，请检查链接是否可访问' })
        return
      }
      res.status(502).json({ error: '网络请求失败，请检查链接是否有效' })
      return
    }
    clearTimeout(timeout)

    if (!fetchRes.ok) {
      res.status(502).json({ error: `目标服务器拒绝访问（${fetchRes.status}）` })
      return
    }

    // 检查 Content-Type，过滤明显非文本的响应
    const contentType = fetchRes.headers.get('content-type') || ''
    if (contentType.includes('application/octet-stream')
      || contentType.includes('video/')
      || contentType.includes('audio/')
      || contentType.includes('image/')) {
      res.status(400).json({ error: '该链接不是文本文件，无法读取代码' })
      return
    }

    // 读取内容，限制 1MB
    const text = await fetchRes.text()
    if (text.length > 1_048_576) {
      res.status(400).json({ error: '文件过大（超过 1MB），请手动粘贴代码' })
      return
    }

    const lineCount = text.split('\n').length

    res.json({
      content: text,
      byteSize: text.length,
      lineCount
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    res.status(500).json({ error: `抓取失败：${message}` })
  }
})

export { tasksRouter }
