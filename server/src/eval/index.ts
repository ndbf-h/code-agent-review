import 'dotenv/config'
import { resolve } from 'node:path'
import { runRagSuite } from './evalRag'
import { runReviewSuite, rematchSuite } from './evalReview'
import { runJudgeSuite, renderJudgeReport } from './evalJudge'
import { renderRagReport, renderReviewReport, writeReport } from './report'
import { pct } from './metrics'
import type { EvalTier } from './types'

/**
 * 评测 CLI：
 *   npm run eval -- --suite rag                          # RAG 检索评测（零成本）
 *   npm run eval -- --suite review --limit 10            # 审查评测冒烟（约 10 次 LLM 审查）
 *   npm run eval -- --suite review --tier easy,adversarial
 *   npm run eval -- --suite rematch --from <review报告.json>   # 零成本复算（匹配器校准后）
 *   npm run eval -- --suite judge --from evals/reports/xxx.json
 *   npm run eval -- --suite all                          # rag + review + judge（judge 复用本次 review 结果）
 */

interface CliOptions {
  suite: string
  limit?: number
  tiers?: EvalTier[]
  label?: string
  from?: string
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { suite: 'rag' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--suite' && next) {
      options.suite = next
      i++
    } else if (arg === '--limit' && next) {
      options.limit = parseInt(next, 10)
      i++
    } else if (arg === '--tier' && next) {
      options.tiers = next
        .split(',')
        .map(t => t.trim())
        .filter(Boolean) as EvalTier[]
      i++
    } else if (arg === '--label' && next) {
      options.label = next
      i++
    } else if (arg === '--from' && next) {
      options.from = next
      i++
    }
  }
  return options
}

function datasetPath(name: string): string {
  // npm run eval 固定从 server/ 目录发起，仓库根为其上一级（对 tsx 与 dist 运行一致）
  return resolve(process.cwd(), '../evals/datasets', name)
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const suites = options.suite === 'all' ? ['rag', 'review', 'judge'] : [options.suite]
  console.log(`[eval] 运行套件: ${suites.join(' -> ')}`)

  let reviewJsonPath: string | undefined

  if (suites.includes('rag')) {
    const dual = await runRagSuite(datasetPath('rag.queries.jsonl'))
    const path = writeReport('rag', options.label, renderRagReport(dual), dual)
    console.log(
      `\n[eval:rag] baseline Recall@5=${pct(dual.baseline.summary.avgRecallAt5)} → hybrid ${pct(dual.hybrid.summary.avgRecallAt5)}（MRR ${dual.baseline.summary.avgMrr.toFixed(3)} → ${dual.hybrid.summary.avgMrr.toFixed(3)}）`
    )
    if (!dual.mode.vectorBranch) {
      console.log(
        '[eval:rag] ⚠️ 未配置 EMBEDDING_API_KEY，hybrid 运行在 BM25 单分支——中文查询的中英跨语言召回需配置嵌入服务后重跑'
      )
    }
    console.log(`[eval:rag] 报告已写入 ${path}.md`)
  }

  if (suites.includes('rematch')) {
    if (!options.from) {
      throw new Error('rematch 套件需要 --from <review报告.json>')
    }
    const output = rematchSuite(
      options.from.endsWith('.json') ? options.from : `${options.from}.json`
    )
    const markdown = renderReviewReport(output.summary, output.results, output.samples)
    const path = writeReport('review', options.label || 'rematch', markdown, {
      summary: output.summary,
      results: output.results,
      samples: output.samples,
      tokenUsage: output.tokenUsage,
      rematchedFrom: options.from
    })
    console.log(
      `\n[eval:rematch] 校准后召回率=${pct(output.summary.issueRecall)}（原报告的匹配结果已被替换）`
    )
    console.log(`[eval:rematch] 报告已写入 ${path}.md`)
  }

  if (suites.includes('review')) {
    if (!process.env.LLM_API_KEY) {
      throw new Error(
        '审查评测需要 LLM_API_KEY（成本提示：全量 48 样本约 ¥5~15，建议先 --limit 5 冒烟）'
      )
    }
    const output = await runReviewSuite({
      datasetPath: datasetPath('code-review.golden.jsonl'),
      limit: options.limit,
      tiers: options.tiers
    })
    const markdown = renderReviewReport(output.summary, output.results, output.samples)
    reviewJsonPath = writeReport('review', options.label, markdown, {
      summary: output.summary,
      results: output.results,
      samples: output.samples,
      tokenUsage: output.tokenUsage
    })
    console.log(
      `\n[eval:review] 召回率=${pct(output.summary.issueRecall)} fallback率=${pct(output.summary.fallbackRate)} 平均分=${output.summary.avgScore.toFixed(1)}`
    )
    console.log(`[eval:review] token 用量: ${output.tokenUsage.totalTokens}（报告含完整明细）`)
    console.log(`[eval:review] 报告已写入 ${reviewJsonPath}.md`)
  }

  if (suites.includes('judge')) {
    const from = options.from || reviewJsonPath
    if (!from) {
      throw new Error('judge 套件需要 --from <review报告.json>，或与 review 套件同批运行')
    }
    const output = await runJudgeSuite(from.endsWith('.json') ? from : `${from}.json`)
    writeReport('judge', options.label, renderJudgeReport(output), output)
    console.log(
      `\n[eval:judge] coverage=${output.avgCoverage.toFixed(1)}/10 precision=${output.avgPrecision.toFixed(1)}/10 分歧=${output.disagreementCount}`
    )
  }
}

main().catch(error => {
  console.error('[eval] 运行失败:', error instanceof Error ? error.message : error)
  process.exit(1)
})
