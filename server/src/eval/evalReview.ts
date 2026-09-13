import { v4 as uuidv4 } from 'uuid'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runReviewTask } from '../agent/orchestrator'
import { registerAllTools } from '../tools/index'
import { getTokenUsage, resetTokenUsage } from '../agent/llm-client'
import { loadJsonl, validateReviewSample } from './dataset'
import { detectInjectionCompliance, evaluateSampleMatch, summarizeReview } from './matcher'
import type { CodeReviewSample, Dimension, EvalTier, ReportIssueLike, ReviewRunResult, ReviewSuiteSummary } from './types'

export interface ReviewSuiteOptions {
  datasetPath: string
  limit?: number
  tiers?: EvalTier[]
}

export interface ReviewSuiteOutput {
  summary: ReviewSuiteSummary
  results: ReviewRunResult[]
  samples: CodeReviewSample[]
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number }
}

/**
 * 审查质量评测：直调 runReviewTask（不经队列、不写生产表——taskId 用 eval- 前缀，
 * messages 持久化因外键约束失败且被静默吞掉，天然零副作用）。
 * 串行执行：agentLatency/tokenUsage 为模块级单例，并行会互相污染。
 */
export async function runReviewSuite(options: ReviewSuiteOptions): Promise<ReviewSuiteOutput> {
  registerAllTools()
  resetTokenUsage()

  const all = loadJsonl(options.datasetPath, validateReviewSample)
  let samples = all
  if (options.tiers && options.tiers.length > 0) {
    samples = samples.filter(s => options.tiers!.includes(s.tier))
  }
  if (options.limit && options.limit > 0) {
    samples = samples.slice(0, options.limit)
  }

  console.log(`[eval:review] 数据集共 ${all.length} 个样本，本次运行 ${samples.length} 个（串行执行）`)

  const results: ReviewRunResult[] = []
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    const taskId = `eval-${uuidv4()}`
    const startedAt = Date.now()
    process.stdout.write(`[${i + 1}/${samples.length}] ${sample.id} (${sample.tier}) 运行中... `)
    try {
      const report = await runReviewTask(taskId, sample.code, sample.language, () => undefined)
      const agentIssues: Partial<Record<Dimension, ReportIssueLike[]>> = {}
      for (const [dimension, result] of Object.entries(report.agentResults || {})) {
        agentIssues[dimension as Dimension] = (result.issues || []).map(issue => ({
          line: issue.line,
          severity: issue.severity,
          category: issue.category,
          message: issue.message,
          suggestion: issue.suggestion
        }))
      }
      const { expectedMatched, extraFindings, dimensionMismatchCount } = evaluateSampleMatch(sample, agentIssues)
      const matchedCount = expectedMatched.filter(Boolean).length
      results.push({
        sampleId: sample.id,
        tier: sample.tier,
        language: sample.language,
        ok: true,
        score: report.score,
        reviewStatus: report.reviewStatus,
        issues: (report.issues || []).map(issue => ({
          line: issue.line, severity: issue.severity, category: issue.category,
          message: issue.message, suggestion: issue.suggestion
        })),
        agentIssues,
        expectedMatched,
        extraFindings,
        dimensionMismatchCount,
        suspectedInjectionCompliance: detectInjectionCompliance(sample, { score: report.score, matchedCount }),
        durationMs: Date.now() - startedAt
      })
      console.log(`完成 score=${report.score} 命中 ${matchedCount}/${expectedMatched.length}`)
    } catch (error) {
      results.push({
        sampleId: sample.id,
        tier: sample.tier,
        language: sample.language,
        ok: false,
        score: 0,
        reviewStatus: undefined,
        issues: [],
        agentIssues: {},
        expectedMatched: sample.expectedIssues.map(() => false),
        extraFindings: 0,
        dimensionMismatchCount: 0,
        suspectedInjectionCompliance: false,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      })
      console.log(`失败 ${error instanceof Error ? error.message : error}`)
    }
  }

  return {
    summary: summarizeReview(results),
    results,
    samples,
    tokenUsage: getTokenUsage()
  }
}

interface ReviewReportPayload {
  samples: CodeReviewSample[]
  results: ReviewRunResult[]
}

/**
 * 复算模式：加载既有 review 报告 JSON，用（可能已校准的）匹配器重新匹配，
 * 不重跑 LLM、零成本。用于匹配规则迭代后的基线校准。
 */
export function rematchSuite(fromPath: string): ReviewSuiteOutput {
  const payload = JSON.parse(readFileSync(resolve(fromPath), 'utf-8')) as ReviewReportPayload
  const sampleById = new Map(payload.samples.map(s => [s.id, s]))
  for (const result of payload.results) {
    const sample = sampleById.get(result.sampleId)
    if (!sample) continue
    const { expectedMatched, extraFindings, dimensionMismatchCount } = evaluateSampleMatch(sample, result.agentIssues)
    result.expectedMatched = expectedMatched
    result.extraFindings = extraFindings
    result.dimensionMismatchCount = dimensionMismatchCount
    const matchedCount = expectedMatched.filter(Boolean).length
    result.suspectedInjectionCompliance = detectInjectionCompliance(sample, { score: result.score, matchedCount })
  }
  return {
    summary: summarizeReview(payload.results),
    results: payload.results,
    samples: payload.samples,
    tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  }
}
