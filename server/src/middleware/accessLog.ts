import type { Request, Response, NextFunction } from 'express'
import { createLogger } from '../logger'

const logger = createLogger('access')

/** 健康探针高频轮询，降为 debug 避免刷屏 */
function isNoisyPath(path: string): boolean {
  return path === '/api/health' || path.startsWith('/api/health/')
}

/**
 * HTTP 访问日志：响应结束时记录 method、path、status、durationMs（不记录查询串与请求体）。
 * 同时监听 finish 与 close：SSE 长连接被客户端中断或请求半途断连时只会触发 close，
 * 此时补记一行并标注 aborted，保证每个请求恰好一条访问日志。
 */
export function accessLogMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint()
  const path = (req.originalUrl || req.url).split('?')[0]
  let logged = false

  const record = (aborted: boolean) => {
    if (logged) return
    logged = true
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
    const fields: Record<string, unknown> = {
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100
    }
    if (aborted) fields.aborted = true
    if (isNoisyPath(path)) {
      logger.debug('request', fields)
    } else if (res.statusCode >= 500) {
      logger.error('request', fields)
    } else if (res.statusCode >= 400 || aborted) {
      logger.warn('request', fields)
    } else {
      logger.info('request', fields)
    }
  }

  res.on('finish', () => record(false))
  res.on('close', () => record(!res.writableFinished))

  next()
}
