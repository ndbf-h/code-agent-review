import express, { type Express, type Request, type Response, type NextFunction } from 'express'
import cors, { type CorsOptions } from 'cors'
import helmet from 'helmet'
import type { AppConfig } from './config'
import { AppError } from './errors'
import { createRateLimiter } from './middleware/rateLimiter'
import { createApiKeyAuth } from './middleware/apiKeyAuth'
import { tasksRouter, metricsRouter } from './routes/tasks'
import { createHealthRouter, type HealthDeps } from './routes/health'
import { createDocsRouter } from './routes/docs'
import { createGitHubWebhookRouter } from './integrations/github/webhook'
import { mountMcpEndpoint } from './mcp/server'
import { requestContextMiddleware } from './middleware/requestContext'
import { accessLogMiddleware } from './middleware/accessLog'
import { createLogger } from './logger'

const logger = createLogger('http')

export interface RateLimitSpec {
  maxRequests: number
  windowMs: number
}

export interface AppDeps {
  config: AppConfig
  health: HealthDeps
  /** 限流参数，默认全局 100/min、任务路由 10/min；单测可调小 */
  rateLimits?: { global?: RateLimitSpec; review?: RateLimitSpec }
  /** 是否挂载 /mcp（默认 true） */
  mountMcp?: boolean
  /** REQ-15：Webhook 创建任务后的入队函数 */
  publishTask?: (taskId: string) => Promise<void>
}

/** body-parser 抛出的错误带 type 字段，用于映射为结构化 4xx 响应 */
interface BodyParserError extends Error {
  type?: string
  status?: number
}

function buildCorsOptions(config: AppConfig): CorsOptions {
  const allowed = config.http.corsOrigins
  return {
    origin:
      allowed === '*'
        ? '*'
        : (origin, callback) => {
            // 无 Origin 的非浏览器请求不受 CORS 约束；浏览器请求按白名单精确匹配
            if (!origin) return callback(null, false)
            callback(null, allowed.includes(origin))
          },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-Request-Id',
      'Last-Event-ID',
      'Accept',
      'Mcp-Session-Id'
    ],
    exposedHeaders: ['X-Request-Id', 'Mcp-Session-Id'],
    maxAge: 600
  }
}

/**
 * 组装 Express 应用：安全头、CORS、限流、body 解析、路由与统一错误处理。
 * 不做任何 I/O（不连库、不监听端口），index.ts 负责装配依赖并启动。
 */
export function createApp(deps: AppDeps): Express {
  const { config } = deps
  const app = express()

  app.set('trust proxy', config.http.trustProxy)
  app.disable('x-powered-by')

  // 请求 ID 最先建立，之后所有中间件与处理器的日志都自动带 requestId
  app.use(requestContextMiddleware)
  app.use(accessLogMiddleware)

  // API 服务不返回 HTML，关闭 CSP 避免干扰 SSE / JSON 客户端；其余 helmet 默认头保留
  app.use(helmet({ contentSecurityPolicy: false }))
  app.use(cors(buildCorsOptions(config)))

  // 全局限流先于 MCP 挂载，保证 /mcp 同样受限
  const globalSpec = deps.rateLimits?.global ?? { maxRequests: 100, windowMs: 60_000 }
  app.use(createRateLimiter(globalSpec.maxRequests, globalSpec.windowMs))

  // REQ-12：API Key 鉴权（API_KEYS 为空时直通），挂在 MCP 之前使 /mcp 同样受保护
  app.use(
    createApiKeyAuth({
      apiKeys: config.auth.apiKeys,
      warnIfDisabled: config.env === 'production'
    })
  )

  // MCP 端点自管 body 解析，必须在全局 express.json() 之前挂载
  if (deps.mountMcp !== false) mountMcpEndpoint(app)

  // REQ-15：Webhook 需要原始 body 做 HMAC 校验，同样必须早于 express.json()
  app.use(
    '/api/webhooks',
    createGitHubWebhookRouter({
      secret: config.github.webhookSecret,
      publishTask: deps.publishTask
    })
  )

  app.use(express.json({ limit: config.http.maxBodySize }))

  const reviewSpec = deps.rateLimits?.review ?? { maxRequests: 10, windowMs: 60_000 }
  app.use('/api/tasks', createRateLimiter(reviewSpec.maxRequests, reviewSpec.windowMs), tasksRouter)
  app.use('/api/metrics', metricsRouter)
  app.use('/api/health', createHealthRouter(deps.health))
  // REQ-16：接口文档（/api/openapi.json、/api/docs），无需鉴权
  app.use('/api', createDocsRouter())

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: '接口不存在', code: 'NOT_FOUND' })
  })

  // 全局错误处理（必须在路由之后注册）
  app.use((err: BodyParserError, _req: Request, res: Response, _next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined
    if (err instanceof AppError) {
      const body = err.toJSON()
      if (err.statusCode >= 500) {
        logger.error('业务异常', { code: err.code, status: err.statusCode, err })
        res.status(err.statusCode).json({ ...body, requestId })
        return
      }
      res.status(err.statusCode).json(body)
      return
    }
    if (err.type === 'entity.too.large') {
      res.status(413).json({
        error: `请求体超过上限 ${config.http.maxBodySize}`,
        code: 'PAYLOAD_TOO_LARGE'
      })
      return
    }
    if (err.type === 'entity.parse.failed') {
      res.status(400).json({ error: '请求体不是合法 JSON', code: 'INVALID_JSON' })
      return
    }
    if (err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') {
      res.status(415).json({ error: '不支持的请求编码', code: 'UNSUPPORTED_MEDIA_TYPE' })
      return
    }
    logger.error('未处理的异常', err)
    res.status(500).json({ error: '内部服务器错误', code: 'INTERNAL_ERROR', requestId })
  })

  return app
}
