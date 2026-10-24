import { Router, type Request, type Response, type NextFunction } from 'express'
import { resolveAndCheckIp as resolveAndCheckIpSafe } from '../utils/urlSafety'
import { getConfig } from '../config'
import { validate } from '../validation/middleware'
import { fetchUrlBodySchema, type FetchUrlBody } from '../validation/schemas'

/** URL 抓取路由（POST /api/tasks/fetch-url） */
export const fetchUrlRouter = Router()

const MAX_REDIRECTS = 3

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

  await resolveAndCheckIpSafe(parsed.hostname)

  const fetchRes = await fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      Accept: 'text/plain,text/html;q=0.5'
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

// POST /api/tasks/fetch-url — 抓取 URL 代码内容
fetchUrlRouter.post(
  '/fetch-url',
  validate({ body: fetchUrlBodySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { url } = req.body as FetchUrlBody
      const parsed = new URL(url)

      // DNS 解析 + IP 校验（防止 SSRF 访问内网）
      try {
        await resolveAndCheckIpSafe(parsed.hostname)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'IP 校验失败'
        res.status(400).json({ error: message, code: 'URL_BLOCKED' })
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
          res.status(408).json({ error: '请求超时，请检查链接是否可访问', code: 'FETCH_TIMEOUT' })
          return
        }
        const message = err instanceof Error ? err.message : '网络请求失败'
        res.status(502).json({ error: message, code: 'FETCH_FAILED' })
        return
      }
      clearTimeout(timeout)

      if (!fetchRes.ok) {
        const reason =
          fetchRes.status >= 500
            ? `目标服务器异常（${fetchRes.status}）`
            : `目标服务器拒绝访问（${fetchRes.status}）`
        res.status(502).json({ error: reason, code: 'FETCH_UPSTREAM_ERROR' })
        return
      }

      // 检查 Content-Type，过滤明显非文本的响应
      const contentType = fetchRes.headers.get('content-type') || ''
      if (
        contentType.includes('application/octet-stream') ||
        contentType.includes('video/') ||
        contentType.includes('audio/') ||
        contentType.includes('image/')
      ) {
        res
          .status(400)
          .json({ error: '该链接不是文本文件，无法读取代码', code: 'CONTENT_NOT_TEXT' })
        return
      }

      // 读取内容，上限与单次审查代码上限一致（MAX_CODE_CHARS）
      const maxChars = getConfig().http.maxCodeChars
      const text = await fetchRes.text()
      if (text.length > maxChars) {
        res.status(400).json({
          error: `文件过大（超过 ${maxChars} 字符），请手动粘贴代码`,
          code: 'CONTENT_TOO_LARGE'
        })
        return
      }

      const lineCount = text.trimEnd().split('\n').length || 1

      res.json({
        content: text,
        byteSize: Buffer.byteLength(text, 'utf8'),
        lineCount
      })
    } catch (error) {
      next(error)
    }
  }
)
