import { Router, type Request, type Response } from 'express'
import { aggregateTaskMetrics, getReviewCacheStats, recentTaskFailures } from '../db/queries'
import { getRequestCount, getTokenUsage, resetTokenUsage } from '../agent/llm-client'
import { getAgentLatency, resetAgentLatency } from '../agent/orchestrator'

/** 可观测性指标路由（GET /api/metrics、POST /api/metrics/reset） */
export const metricsRouter = Router()

// GET /api/metrics
metricsRouter.get('/', async (_req: Request, res: Response) => {
  const tokenUsage = getTokenUsage()
  const agentLatency = getAgentLatency()
  const requestCount = getRequestCount()
  const uptime = process.uptime()

  // 任务级聚合来自 task_metrics 落库（跨进程真实数据）；进程内计数器保留兼容旧面板
  const since24h = new Date(Date.now() - 24 * 3600_000).toISOString()
  const since7d = new Date(Date.now() - 7 * 24 * 3600_000).toISOString()
  const [last24h, last7d, failures, reviewCache] = await Promise.all([
    aggregateTaskMetrics(since24h).catch(() => null),
    aggregateTaskMetrics(since7d).catch(() => null),
    recentTaskFailures(10).catch(() => []),
    getReviewCacheStats().catch(() => ({ entries: 0, totalHits: 0 }))
  ])

  res.json({
    tokenUsage: {
      promptTokens: tokenUsage.promptTokens,
      completionTokens: tokenUsage.completionTokens,
      totalTokens: tokenUsage.totalTokens
    },
    agentLatency: {
      preScan: agentLatency.preScan,
      orchestration: agentLatency.orchestration,
      reviewers: agentLatency.reviewers,
      reportGeneration: agentLatency.reportGeneration,
      total: agentLatency.total
    },
    requestCount,
    uptime: Math.round(uptime),
    tasks: {
      last24h,
      last7d,
      recentFailures: failures
    },
    reviewCache
  })
})

// POST /api/metrics/reset — 重置所有计数器
metricsRouter.post('/reset', (_req: Request, res: Response) => {
  resetTokenUsage()
  resetAgentLatency()
  res.json({ message: '计数器已重置' })
})
