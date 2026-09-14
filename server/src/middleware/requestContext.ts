import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'

export interface RequestContext {
  requestId: string
}

const storage = new AsyncLocalStorage<RequestContext>()

export const REQUEST_ID_HEADER = 'x-request-id'

/** 允许透传的请求 ID：1 到 128 位的字母、数字、点、下划线、连字符 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/

/** 当前异步上下文中的请求 ID（不在请求上下文中返回 undefined） */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId
}

/** 在指定上下文中运行 fn（供队列消费者等非 HTTP 入口复用同一套 requestId 机制） */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn)
}

/** 校验并规整来自客户端的 X-Request-Id；不合法返回 undefined */
export function normalizeIncomingRequestId(value: unknown): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value
  if (typeof candidate !== 'string') return undefined
  const trimmed = candidate.trim()
  return REQUEST_ID_PATTERN.test(trimmed) ? trimmed : undefined
}

/**
 * 请求上下文中间件：透传合法的 X-Request-Id，否则生成 UUID；
 * 回写响应头并放入 AsyncLocalStorage，后续日志自动附带 requestId。
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = normalizeIncomingRequestId(req.headers[REQUEST_ID_HEADER]) ?? randomUUID()
  res.setHeader('X-Request-Id', requestId)
  res.locals.requestId = requestId
  storage.run({ requestId }, () => next())
}
