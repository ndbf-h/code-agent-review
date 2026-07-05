import { Router, type Request, type Response, type NextFunction } from 'express'
import { ValidationError, TaskError } from '../errors'
import { createTask, createAgentsForTask, saveReport, getTaskDetail, updateTaskStatus } from '../services/taskService'
import { runReviewTask } from '../agent/orchestrator'
import type { ReviewEvent } from '../agent/orchestrator'
import dns from 'node:dns'
import { isIPv4, isIPv6 } from 'node:net'

const tasksRouter = Router()

// POST /api/tasks
tasksRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, language, title } = req.body

    if (!code || !language) {
      throw new ValidationError('code 和 language 为必填项')
    }

    const task = await createTask(code, language, title)
    await createAgentsForTask(task.id)

    res.status(201).json(task)
  } catch (error) {
    next(error)
  }
})

// GET /api/tasks/:id
tasksRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const detail = await getTaskDetail(req.params.id)
    if (!detail.task) {
      throw new TaskError('Task not found', 'TASK_NOT_FOUND', 404)
    }
    res.json(detail)
  } catch (error) {
    next(error)
  }
})

// GET /api/tasks/:id/stream
tasksRouter.get('/:id/stream', async (req: Request, res: Response) => {
  const taskId = req.params.id

  // 并发控制：原子地检查并获取任务槽位（同步操作无await间隙，利用事件循环单线程特性保证原子性）
  const locals = req.app.locals as { activeTaskCount: number; maxConcurrentTasks: number }
  if (!tryAcquireSlot(locals)) {
    res.status(503).json({
      error: `当前审查任务已满（${locals.maxConcurrentTasks} 个），请等待...`,
      code: 'CONCURRENCY_LIMITED'
    })
    return
  }

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

  try {
    const detail = await getTaskDetail(taskId)
    if (!detail.task) {
      sendEvent('error', { message: 'Task not found' })
      res.end()
      return
    }

    await updateTaskStatus(taskId, 'orchestrating')

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
  } finally {
    locals.activeTaskCount--
    res.end()
  }
})

// POST /api/tasks/fetch-url — 抓取 URL 代码内容

/** 原子地尝试获取并发任务槽位，成功返回 true 并递增计数，失败返回 false */
function tryAcquireSlot(locals: { activeTaskCount: number; maxConcurrentTasks: number }): boolean {
  if (locals.activeTaskCount >= locals.maxConcurrentTasks) {
    return false
  }
  locals.activeTaskCount++
  return true
}

const MAX_REDIRECTS = 3

function isPrivateIp(ip: string): boolean {
  if (isIPv4(ip)) {
    const parts = ip.split('.').map(Number)
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return true
    const [a, b] = parts
    // 0.0.0.0/8
    if (a === 0) return true
    // 10.0.0.0/8
    if (a === 10) return true
    // 127.0.0.0/8
    if (a === 127) return true
    // 169.254.0.0/16
    if (a === 169 && b === 254) return true
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true
    return false
  }
  if (isIPv6(ip)) {
    // ::1
    if (ip === '::1') return true
    // fe80::/10
    if (ip.toLowerCase().startsWith('fe80:')) return true
    return false
  }
  // 无法识别为 IP，保守拒绝
  return true
}

async function resolveAndCheckIp(hostname: string): Promise<void> {
  let addresses: string[] = []
  try {
    addresses = await dns.promises.resolve4(hostname).catch(() => [] as string[])
  } catch {
    // IPv4 解析失败，继续尝试 IPv6
  }
  try {
    const v6 = await dns.promises.resolve6(hostname).catch(() => [] as string[])
    addresses = addresses.concat(v6)
  } catch {
    // IPv6 解析失败
  }

  // DNS 解析不到任何 IP：可能是网络环境限制，跳过 SSRF 校验
  // 后续 fetch 会自行处理连接失败
  if (addresses.length === 0) return

  for (const addr of addresses) {
    if (isPrivateIp(addr)) {
      throw new Error(`禁止访问内网地址：${addr}`)
    }
  }
}

async function fetchWithRedirectCheck(
  url: string,
  controller: AbortController,
  redirectCount: number
): Promise<globalThis.Response> {
  if (redirectCount > MAX_REDIRECTS) {
    throw new Error('重定向次数超过限制')
  }

  // 每次请求前校验目标 URL
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('重定向目标 URL 格式不正确')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('重定向目标使用了不支持的协议')
  }

  await resolveAndCheckIp(parsed.hostname)

  const fetchRes = await fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'text/plain,text/html;q=0.5'
    },
    redirect: 'manual'
  })

  // 处理重定向
  const redirectStatuses = [301, 302, 303, 307, 308]
  if (redirectStatuses.includes(fetchRes.status)) {
    const location = fetchRes.headers.get('location')
    if (!location) {
      return fetchRes
    }
    const nextUrl = new URL(location, url).toString()
    return fetchWithRedirectCheck(nextUrl, controller, redirectCount + 1)
  }

  return fetchRes
}

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

    // DNS 解析 + IP 校验（防止 SSRF 访问内网）
    try {
      await resolveAndCheckIp(parsed.hostname)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'IP 校验失败'
      res.status(400).json({ error: message })
      return
    }

    // 抓取内容，10 秒超时，手动处理重定向
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    let fetchRes: globalThis.Response
    try {
      fetchRes = await fetchWithRedirectCheck(url, controller, 0)
    } catch (err) {
      clearTimeout(timeout)
      if (err instanceof Error && err.name === 'AbortError') {
        res.status(408).json({ error: '请求超时，请检查链接是否可访问' })
        return
      }
      const message = err instanceof Error ? err.message : '网络请求失败'
      res.status(502).json({ error: message })
      return
    }
    clearTimeout(timeout)

    if (!fetchRes.ok) {
      if (fetchRes.status >= 500) {
        res.status(502).json({ error: `目标服务器异常（${fetchRes.status}）` })
      } else {
        res.status(502).json({ error: `目标服务器拒绝访问（${fetchRes.status}）` })
      }
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

    const lineCount = text.trimEnd().split('\n').length || 1

    res.json({
      content: text,
      byteSize: Buffer.byteLength(text, 'utf8'),
      lineCount
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    res.status(500).json({ error: `抓取失败：${message}` })
  }
})

export { tasksRouter }
