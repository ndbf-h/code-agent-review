import { Router, type Request, type Response } from 'express'

/** 健康检查依赖：通过注入实现，便于单测与替换 */
export interface HealthDeps {
  /** 执行 SELECT 1 等轻量查询；成功 resolve true，失败 reject 或 resolve false */
  checkDb: () => Promise<boolean>
  /** RabbitMQ 会话当前是否已建立 */
  isRabbitConnected: () => boolean
  /** LLM 端点探测（仅 /api/health?deep=1 时调用） */
  checkLlm: () => Promise<boolean>
  /** 单项依赖检查超时（毫秒），默认 2000 */
  timeoutMs?: number
}

export type CheckStatus = 'ok' | 'fail'

export interface ReadinessResult {
  ready: boolean
  checks: { db: CheckStatus; rabbitmq: CheckStatus }
}

/** 执行检查函数：同步抛错、reject、超时、返回非 true 一律视为失败，且不会向外抛出 */
function withTimeout(check: () => Promise<boolean> | boolean, ms: number): Promise<boolean> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), ms)
    Promise.resolve()
      .then(() => check())
      .then(ok => resolve(ok === true))
      .catch(() => resolve(false))
      .finally(() => clearTimeout(timer))
  })
}

/** 并行检查 PG 与 RabbitMQ，任一失败即不就绪；本函数不会 reject */
export async function checkReadiness(deps: HealthDeps): Promise<ReadinessResult> {
  const timeoutMs = deps.timeoutMs ?? 2000
  const [dbOk, rabbitOk] = await Promise.all([
    withTimeout(deps.checkDb, timeoutMs),
    withTimeout(() => deps.isRabbitConnected(), timeoutMs)
  ])
  return {
    ready: dbOk && rabbitOk,
    checks: { db: dbOk ? 'ok' : 'fail', rabbitmq: rabbitOk ? 'ok' : 'fail' }
  }
}

/**
 * 健康探针路由（挂载于 /api/health）
 * - GET /live   进程存活即 200，不做任何外部调用（Kubernetes livenessProbe）
 * - GET /ready  PG + RabbitMQ 全部就绪 200，否则 503（readinessProbe / compose healthcheck）
 * - GET /       向后兼容的合集视图；?deep=1 时额外探测 LLM
 */
export function createHealthRouter(deps: HealthDeps): Router {
  const router = Router()

  router.get('/live', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptime: process.uptime() })
  })

  router.get('/ready', async (_req: Request, res: Response) => {
    const result = await checkReadiness(deps)
    res.status(result.ready ? 200 : 503).json({
      status: result.ready ? 'ok' : 'degraded',
      checks: result.checks
    })
  })

  router.get('/', async (req: Request, res: Response) => {
    const deep = req.query.deep === '1' || req.query.deep === 'true'
    const timeoutMs = deps.timeoutMs ?? 2000
    const [readiness, llmOk] = await Promise.all([
      checkReadiness(deps),
      deep ? withTimeout(deps.checkLlm, Math.max(timeoutMs, 5000)) : Promise.resolve(null)
    ])
    const checks: Record<string, CheckStatus> = { ...readiness.checks }
    if (llmOk !== null) checks.llm = llmOk ? 'ok' : 'fail'
    res.status(readiness.ready ? 200 : 503).json({
      status: readiness.ready ? 'ok' : 'degraded',
      uptime: process.uptime(),
      checks
    })
  })

  return router
}
