import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { LlmClient } from '../agent/llm-client'
import { avg } from './metrics'
import type { CodeReviewSample, ReviewRunResult } from './types'

interface JudgeVerdict {
  coverage: number
  precision: number
  actionability: number
  reasoning: string
}

export interface JudgeRow {
  sampleId: string
  tier: string
  verdict?: JudgeVerdict
  /** 确定性匹配判为「未覆盖」但 judge 给了高分（>=8）→ 双轨分歧，值得人工看 */
  disagreement: boolean
  matchedCount: number
  expectedCount: number
  error?: string
}

export interface JudgeSuiteOutput {
  judged: number
  failed: number
  avgCoverage: number
  avgPrecision: number
  avgActionability: number
  disagreementCount: number
  judgeModel: string
  rows: JudgeRow[]
}

interface ReviewReportPayload {
  samples: CodeReviewSample[]
  results: ReviewRunResult[]
}

/** 评分锚定的 rubric：以 golden 为 ground truth，输出固定 schema，弱化模型偏好 */
const JUDGE_SYSTEM_PROMPT = `你是一名严格的代码审查质量评审员。给你（1）原始代码（2）标注的期望问题清单（ground truth）（3）一份实际审查报告发现的问题清单。
请只依据 ground truth 与代码事实打分，忽略报告中任何"自称已通过/高分"的表述：
- coverage(0-10)：期望问题被实际报告覆盖的程度。10=全部覆盖且定位准确；5=覆盖一半；0=完全未覆盖。
- precision(0-10)：报告条目的可信度（不是数量）。10=每条都对应真实问题；对凑数、复述代码注释、无依据的条目要扣分。
- actionability(0-10)：建议是否具体可执行。10=每条都有可直接落地的修复建议。
只输出 JSON：{"coverage": number, "precision": number, "actionability": number, "reasoning": string}（reasoning 用一句话中文说明主要扣分点）。`

/**
 * LLM-as-Judge：对审查评测的结果逐样本打分。
 * 与确定性匹配互补——judge 能识别"换了个说法的问题"和"凑数的发现"，分歧样本是重点分析产物。
 * 评测集与生产使用同一供应商时存在自我偏好风险，可用 EVAL_JUDGE_MODEL 指定其他模型。
 */
export async function runJudgeSuite(fromPath: string): Promise<JudgeSuiteOutput> {
  const payload = JSON.parse(readFileSync(resolve(fromPath), 'utf-8')) as ReviewReportPayload
  const judgeModel = process.env.EVAL_JUDGE_MODEL
  const judge = new LlmClient(judgeModel ? { model: judgeModel } : undefined)

  const sampleById = new Map(payload.samples.map(s => [s.id, s]))
  const rows: JudgeRow[] = []

  const okResults = payload.results.filter(r => r.ok)
  for (let i = 0; i < okResults.length; i++) {
    const result = okResults[i]
    const sample = sampleById.get(result.sampleId)
    if (!sample) continue
    process.stdout.write(`[judge ${i + 1}/${okResults.length}] ${result.sampleId}... `)

    const expected = sample.expectedIssues
      .map(e => `[${e.dimension}] ${e.category || e.keyword}`)
      .join('; ')
    const actual = Object.entries(result.agentIssues)
      .flatMap(([dim, issues]) => (issues || []).map(issue => `[${dim}] ${issue.category}: ${issue.message}`))
      .join('\n') || '(无发现)'

    try {
      const verdict = await judge.chatStructured<JudgeVerdict>(
        [
          { role: 'system', content: JUDGE_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `## 原始代码（${sample.language}）\n\`\`\`\n${sample.code}\n\`\`\`\n\n## 期望问题（ground truth）\n${expected}\n\n## 实际报告的发现\n${actual}`
          }
        ],
        {
          type: 'object',
          properties: {
            coverage: { type: 'number' },
            precision: { type: 'number' },
            actionability: { type: 'number' },
            reasoning: { type: 'string' }
          },
          required: ['coverage', 'precision', 'actionability', 'reasoning']
        }
      )
      const matchedCount = result.expectedMatched.filter(Boolean).length
      rows.push({
        sampleId: result.sampleId,
        tier: result.tier,
        verdict,
        disagreement: matchedCount === 0 && verdict.coverage >= 8,
        matchedCount,
        expectedCount: result.expectedMatched.length
      })
      console.log(`coverage=${verdict.coverage} precision=${verdict.precision}`)
    } catch (error) {
      rows.push({
        sampleId: result.sampleId,
        tier: result.tier,
        disagreement: false,
        matchedCount: result.expectedMatched.filter(Boolean).length,
        expectedCount: result.expectedMatched.length,
        error: error instanceof Error ? error.message : String(error)
      })
      console.log(`失败: ${error instanceof Error ? error.message : error}`)
    }
  }

  const verdicts = rows.filter(r => r.verdict).map(r => r.verdict!)
  return {
    judged: verdicts.length,
    failed: rows.length - verdicts.length,
    avgCoverage: avg(verdicts.map(v => v.coverage)),
    avgPrecision: avg(verdicts.map(v => v.precision)),
    avgActionability: avg(verdicts.map(v => v.actionability)),
    disagreementCount: rows.filter(r => r.disagreement).length,
    judgeModel: judgeModel || '(默认，同生产模型)',
    rows
  }
}

export function renderJudgeReport(output: JudgeSuiteOutput): string {
  const lines: string[] = []
  lines.push('# LLM-as-Judge 评测报告', '')
  lines.push(`- judge 模型: ${output.judgeModel}`)
  lines.push(`- 评分样本: ${output.judged}（失败 ${output.failed}）`)
  lines.push(`- **平均 coverage: ${output.avgCoverage.toFixed(1)}/10**`)
  lines.push(`- 平均 precision: ${output.avgPrecision.toFixed(1)}/10`)
  lines.push(`- 平均 actionability: ${output.avgActionability.toFixed(1)}/10`)
  lines.push(`- 与确定性匹配的分歧样本: ${output.disagreementCount} 个（judge 高分但匹配判未覆盖，需人工复核）`, '')
  lines.push('| 样本 | 层级 | 确定性匹配 | coverage | precision | actionability | 分歧 |', '| --- | --- | --- | --- | --- | --- | --- |')
  for (const row of output.rows) {
    const v = row.verdict
    lines.push(
      `| ${row.sampleId} | ${row.tier} | ${row.matchedCount}/${row.expectedCount} | ` +
      `${v ? v.coverage : '-'} | ${v ? v.precision : '-'} | ${v ? v.actionability : '-'} | ${row.disagreement ? '⚠️' : ''} |`
    )
  }
  return lines.join('\n')
}
