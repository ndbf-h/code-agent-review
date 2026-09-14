import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { RagQueryResult, RagSuiteSummary, ReviewRunResult, ReviewSuiteSummary } from './types'
import type { CodeReviewSample } from './types'
import { summarizeByDimension } from './matcher'
import { pct } from './metrics'

function ensureReportsDir(): string {
  // 与 datasetPath 同理：从 server/ 目录发起，报告目录在仓库根 evals/reports
  const dir = resolve(process.cwd(), '../evals/reports')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 报告文件名：日期 + 套件名 + 可选标签，markdown 与 json 成对产出（json 供后续 CI diff） */
export function writeReport(
  suite: string,
  label: string | undefined,
  markdown: string,
  payload: unknown
): string {
  const dir = ensureReportsDir()
  const stamp = new Date().toISOString().slice(0, 10)
  const suffix = label ? `-${label}` : ''
  const base = resolve(dir, `${stamp}-${suite}${suffix}`)
  writeFileSync(`${base}.md`, markdown, 'utf-8')
  writeFileSync(`${base}.json`, JSON.stringify(payload, null, 2), 'utf-8')
  return base
}

export interface RagDualReport {
  baseline: { summary: RagSuiteSummary; results: RagQueryResult[] }
  hybrid: { summary: RagSuiteSummary; results: RagQueryResult[] }
  mode: { vectorBranch: boolean; rerankBranch: boolean }
}

export function renderRagReport(dual: RagDualReport): string {
  const { baseline, hybrid, mode } = dual
  const lines: string[] = []
  lines.push('# RAG 检索评测报告（baseline vs hybrid）', '')
  lines.push(`- 查询总数: ${baseline.summary.totalQueries}`)
  lines.push(
    `- hybrid 运行模式: 向量分支 ${mode.vectorBranch ? '✅ 开启' : '❌ 未配置 EMBEDDING_API_KEY（BM25 单分支）'}，重排 ${mode.rerankBranch ? '✅ 开启' : '未配置'}`,
    ''
  )
  lines.push('## 总体对比', '')
  lines.push(
    '| 指标 | baseline（词元打分） | hybrid（BM25+向量+RRF+重排） |',
    '| --- | --- | --- |'
  )
  lines.push(
    `| **Recall@5** | ${pct(baseline.summary.avgRecallAt5)} | **${pct(hybrid.summary.avgRecallAt5)}** |`
  )
  lines.push(
    `| MRR | ${baseline.summary.avgMrr.toFixed(3)} | ${hybrid.summary.avgMrr.toFixed(3)} |`
  )
  lines.push(
    `| 零结果率 | ${pct(baseline.summary.zeroResultRate)} | ${pct(hybrid.summary.zeroResultRate)} |`
  )
  lines.push(
    `| 提升幅度 | — | Recall@5 ${delta(baseline.summary.avgRecallAt5, hybrid.summary.avgRecallAt5)} |`,
    ''
  )

  lines.push('## 按查询类型对比（Recall@5）', '')
  lines.push('| 类型 | baseline | hybrid | 查询数 |', '| --- | --- | --- | --- |')
  const types = baseline.summary.byType.map(t => t.type)
  for (const type of types) {
    const b = baseline.summary.byType.find(t => t.type === type)!
    const h = hybrid.summary.byType.find(t => t.type === type)
    lines.push(
      `| ${type} | ${pct(b.avgRecallAt5)} | ${h ? pct(h.avgRecallAt5) : '-'} | ${b.queries} |`
    )
  }

  lines.push('', '## hybrid 逐查询明细', '')
  lines.push('| 查询 | 类型 | Recall@5 | MRR | 检索结果 |', '| --- | --- | --- | --- | --- |')
  for (const r of hybrid.results) {
    lines.push(
      `| ${r.queryId} | ${r.type} | ${pct(r.recallAt5)} | ${r.mrr.toFixed(2)} | ${r.retrievedDocIds.join(', ') || '(空)'} |`
    )
  }
  return lines.join('\n')
}

function delta(before: number, after: number): string {
  const diff = after - before
  return diff >= 0 ? `+${(diff * 100).toFixed(1)}pp` : `${(diff * 100).toFixed(1)}pp`
}

export function renderReviewReport(
  summary: ReviewSuiteSummary,
  results: ReviewRunResult[],
  samples: CodeReviewSample[]
): string {
  const byDimension = summarizeByDimension(samples, results)
  const sampleById = new Map(samples.map(s => [s.id, s]))
  const lines: string[] = []
  lines.push('# 代码审查质量评测报告', '')
  lines.push(
    `- 样本总数: ${summary.totalSamples}（成功 ${summary.okSamples} / 失败 ${summary.failedSamples}）`
  )
  lines.push(`- **期望问题召回率: ${pct(summary.issueRecall)}**`)
  lines.push(`- 规则引擎降级率（fallback）: ${pct(summary.fallbackRate)}`)
  lines.push(`- 额外发现（不计误报）: ${summary.extraFindingsTotal} 条`)
  if (summary.suspectedInjectionComplianceCount > 0) {
    lines.push(
      `- **疑似注入服从: ${summary.suspectedInjectionComplianceCount} 个样本（人工复核！）**`
    )
  }
  lines.push(
    `- 平均评分: ${summary.avgScore.toFixed(1)}，平均耗时: ${(summary.avgDurationMs / 1000).toFixed(1)}s`,
    ''
  )
  lines.push('## 分层召回率', '')
  lines.push('| 层级 | 样本数 | 召回率 |', '| --- | --- | --- |')
  for (const row of summary.byTier) {
    lines.push(`| ${row.tier} | ${row.samples} | ${pct(row.recall)} |`)
  }
  lines.push('', '## 分维度召回率', '')
  lines.push('| 维度 | 期望条数 | 命中 | 召回率 |', '| --- | --- | --- | --- |')
  for (const row of byDimension) {
    lines.push(`| ${row.dimension} | ${row.expected} | ${row.hit} | ${pct(row.recall)} |`)
  }

  const misses = results.flatMap(r =>
    r.expectedMatched
      .map((matched, index) => ({ matched, index, sample: sampleById.get(r.sampleId) }))
      .filter(m => !m.matched && m.sample)
      .map(m => ({ ...m, expected: m.sample!.expectedIssues[m.index] }))
  )
  if (misses.length > 0) {
    lines.push('', '## 漏检清单（期望发现但未发现）', '')
    lines.push('| 样本 | 层级 | 维度 | 期望问题 |', '| --- | --- | --- | --- |')
    for (const m of misses.slice(0, 30)) {
      const label = m.expected.category || m.expected.keyword || ''
      lines.push(`| ${m.sample!.id} | ${m.sample!.tier} | ${m.expected.dimension} | ${label} |`)
    }
    if (misses.length > 30) lines.push(`| ...另有 ${misses.length - 30} 条 | | | |`)
  }
  return lines.join('\n')
}
