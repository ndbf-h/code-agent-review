import { createHash, timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { createLogger } from '../logger'

const logger = createLogger('auth')

/**
 * API Key 鉴权（REQ-12）。
 *
 * - `API_KEYS` 为空表示不鉴权（保持向后兼容），生产环境未配置时启动告警；
 * - 支持 `X-API-Key` 与 `Authorization: Bearer <key>` 两种携带方式；
 * - SSE 场景 EventSource 无法自定义请求头，仅 stream 路径额外接受 `?api_key=`；
 * - 密钥比较采用恒定时间算法（先 SHA-256 再 timingSafeEqual），规避长度与时序侧信道。
 */

/** 无需鉴权的路径：健康探针、接口文档、Webhook（后者自行做 HMAC 校验） */
const PUBLIC_PREFIXES = ['/api/health', '/api/openapi.json', '/api/docs', '/api/webhooks']

/** 仅这两个 SSE 路径允许用查询参数传密钥 */
const QUERY_KEY_PATTERNS = [
  /^\/api\/tasks\/[^/]+\/stream\/?$/,
  /^\/api\/tasks\/[^/]+\/chat\/stream\/?$/
]

export interface ApiKeyAuthOptions {
  apiKeys: string[]
  /** 生产环境且未配置密钥时打印告警 */
  warnIfDisabled?: boolean
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function matchesAny(provided: string, keys: string[]): boolean {
  const providedDigest = digest(provided)
  return keys.some(key => timingSafeEqual(providedDigest, digest(key)))
}

function isPublicPath(path: string): boolean {
  return PUBLIC_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`))
}

/** 是否允许从查询参数读取密钥 */
function allowsQueryKey(path: string): boolean {
  return QUERY_KEY_PATTERNS.some(pattern => pattern.test(path))
}

/** 去掉查询串的请求路径 */
function pathOf(req: Request): string {
  return req.path || (req.originalUrl || req.url).split('?')[0]
}

/** 从请求头或（限定的）查询参数中提取候选密钥 */
export function extractApiKey(req: Request): string | null {
  const headerKey = req.get('x-api-key')
  if (headerKey && headerKey.trim()) return headerKey.trim()

  const authorization = req.get('authorization')
  if (authorization) {
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization.trim())
    if (bearer?.[1]) return bearer[1].trim()
  }

  const queryKey = req.query.api_key
  if (typeof queryKey === 'string' && queryKey.trim() && allowsQueryKey(pathOf(req))) {
    return queryKey.trim()
  }
  return null
}

/**
 * 构造鉴权中间件。`API_KEYS` 为空时返回直通中间件（仅在需要时打一条告警）。
 * 调用方应把它挂在路由与 /mcp 之前。
 */
export function createApiKeyAuth(options: ApiKeyAuthOptions) {
  const keys = options.apiKeys.map(key => key.trim()).filter(Boolean)

  if (keys.length === 0) {
    if (options.warnIfDisabled) {
      logger.warn('未配置 API_KEYS，接口处于无鉴权状态（生产环境请配置后重启）')
    }
    return function noAuth(_req: Request, _res: Response, next: NextFunction): void {
      next()
    }
  }

  return function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
    const path = pathOf(req)
    if (isPublicPath(path)) {
      next()
      return
    }

    const provided = extractApiKey(req)
    if (provided && matchesAny(provided, keys)) {
      next()
      return
    }

    logger.warn('API Key 校验失败', { method: req.method, path })
    res.status(401).json({ error: '缺少或无效的 API Key', code: 'UNAUTHORIZED' })
  }
}
