import type { ReportContent } from '../../../shared/types'

export type EvalTier = 'easy' | 'tricky' | 'adversarial'

export type Dimension = 'security' | 'performance' | 'style' | 'logic'

/** golden 集中一条"期望发现的问题"；category 与规则引擎类目全等匹配，keyword 为子串兜底 */
export interface ExpectedIssue {
  dimension: Dimension
  category?: string
  keyword?: string
  note?: string
}

export interface CodeReviewSample {
  id: string
  tier: EvalTier
  language: string
  title?: string
  code: string
  expectedIssues: ExpectedIssue[]
}

export type RagQueryType =
  'exact-english' | 'paraphrase-english' | 'chinese-only' | 'code-snippet' | 'dimension-filtered'

export interface RagQuery {
  id: string
  type: RagQueryType
  query: string
  language?: string
  dimension?: string
  expectedDocIds: string[]
  note?: string
}

/** 与 shared/types 的 Issue 对齐（此处独立声明避免测试耦合 DB/共享层） */
export interface ReportIssueLike {
  line: number
  severity: string
  category: string
  message: string
  suggestion: string
}

export interface ReviewRunResult {
  sampleId: string
  tier: EvalTier
  language: string
  ok: boolean
  score: number
  /** 各维度 reviewer 的完成方式：success = LLM 路径，fallback = 规则引擎降级 */
  reviewStatus: ReportContent['reviewStatus']
  issues: ReportIssueLike[]
  agentIssues: Partial<Record<Dimension, ReportIssueLike[]>>
  /** 每条期望问题是否命中（与 sample.expectedIssues 一一对应） */
  expectedMatched: boolean[]
  extraFindings: number
  /** 期望维度未命中但其他维度找到相同问题的次数（维度归类偏差，不算漏检） */
  dimensionMismatchCount: number
  /** adversarial 层：疑似服从了注入指令（高分 + 期望问题全漏） */
  suspectedInjectionCompliance: boolean
  durationMs: number
  error?: string
}

export interface ReviewSuiteSummary {
  totalSamples: number
  okSamples: number
  failedSamples: number
  /** 期望问题召回率 = 命中条数 / 期望条数 */
  issueRecall: number
  byTier: Array<{ tier: EvalTier; samples: number; recall: number }>
  /** reviewStatus 为 fallback 的 reviewer 占比（可靠性指标：越高说明 LLM 路径越不稳） */
  fallbackRate: number
  extraFindingsTotal: number
  suspectedInjectionComplianceCount: number
  avgScore: number
  avgDurationMs: number
}

export interface RagQueryResult {
  queryId: string
  type: RagQueryType
  expectedDocIds: string[]
  retrievedDocIds: string[]
  recallAt5: number
  mrr: number
  zeroResult: boolean
}

export interface RagSuiteSummary {
  totalQueries: number
  avgRecallAt5: number
  avgMrr: number
  zeroResultRate: number
  byType: Array<{ type: RagQueryType; queries: number; avgRecallAt5: number; avgMrr: number }>
}
