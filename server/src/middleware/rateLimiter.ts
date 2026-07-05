import type { Request, Response, NextFunction } from 'express'

interface RateLimitEntry {
  count: number
  resetAt: number
}

interface RateLimitStore {
  [ip: string]: RateLimitEntry
}

/**
 * 创建基于内存 IP 的限流中间件
 * @param maxRequests  时间窗口内允许的最大请求数
 * @param windowMs     时间窗口（毫秒）
 */
export function createRateLimiter(maxRequests: number, windowMs: number) {
  const store: RateLimitStore = {}

  // 定期清理过期记录，避免内存泄漏
  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const ip of Object.keys(store)) {
      if (store[ip].resetAt < now) {
        delete store[ip]
      }
    }
  }, windowMs)

  // 允许在 Node.js 事件循环闲置时优雅退出
  if (cleanupInterval.unref) {
    cleanupInterval.unref()
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    const now = Date.now()

    if (!store[ip] || store[ip].resetAt < now) {
      // 新窗口开始
      store[ip] = { count: 1, resetAt: now + windowMs }
      next()
      return
    }

    store[ip].count++
    if (store[ip].count > maxRequests) {
      const retryAfter = Math.ceil((store[ip].resetAt - now) / 1000)
      res.status(429).json({
        error: '请求过于频繁，请稍后再试',
        code: 'RATE_LIMITED',
        retryAfter
      })
      return
    }

    next()
  }
}
