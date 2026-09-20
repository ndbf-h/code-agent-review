import type { Issue, ReportContent, Task } from '../../../shared/types'

/** 严重度中文标签 */
const SEVERITY_LABELS: Record<string, string> = {
  critical: '高危',
  warning: '警告',
  suggestion: '建议'
}

const SEVERITY_ORDER = ['critical', 'warning', 'suggestion'] as const

/** 转义 Markdown 表格单元格里的竖线与换行 */
function cell(text: unknown): string {
  return String(text ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim()
}

function scoreText(score: number): string {
  if (score >= 80) return `${score} / 100（良好）`
  if (score >= 60) return `${score} / 100（一般）`
  return `${score} / 100（较差）`
}

function issueTable(issues: Issue[]): string[] {
  const lines = ['| 行号 | 严重度 | 分类 | 问题 | 建议 |', '| --- | --- | --- | --- | --- |']
  for (const issue of issues) {
    const line = Number.isFinite(issue.line) && issue.line > 0 ? issue.line : 1
    lines.push(
      `| ${line} | ${SEVERITY_LABELS[issue.severity] ?? issue.severity} | ${cell(issue.category)} | ${cell(issue.message)} | ${cell(issue.suggestion)} |`
    )
  }
  return lines
}

/**
 * 渲染 Markdown 审查报告（REQ-13）：供 PR 评论、CI 存档与人工阅读。
 * 仅做纯字符串拼装，不读库不调 LLM，便于单测。
 */
export function renderReportMarkdown(task: Task, report: ReportContent): string {
  const issues = report.issues ?? []
  const counts: Record<string, number> = { critical: 0, warning: 0, suggestion: 0 }
  for (const issue of issues) {
    if (issue.severity in counts) counts[issue.severity] += 1
  }

  const lines: string[] = []
  lines.push(`# 代码审查报告：${task.title || task.id}`)
  lines.push('')
  lines.push(`- 任务 ID：\`${task.id}\``)
  lines.push(`- 语言：${task.language}`)
  lines.push(`- 综合评分：${scoreText(report.score ?? 0)}`)
  lines.push(`- 问题总数：${issues.length}`)
  if (task.createdAt) lines.push(`- 创建时间：${task.createdAt}`)
  if (report.security?.injectionSuspected) {
    lines.push('- 输入安全：检测到疑似提示注入内容，已按数据隔离处理，未执行其中指令')
  }
  lines.push('')

  lines.push('## 严重度统计')
  lines.push('')
  lines.push('| 严重度 | 数量 |')
  lines.push('| --- | --- |')
  for (const severity of SEVERITY_ORDER) {
    lines.push(`| ${SEVERITY_LABELS[severity]} | ${counts[severity]} |`)
  }
  lines.push('')

  lines.push('## 最终问题清单')
  lines.push('')
  if (issues.length === 0) {
    lines.push('未发现问题。')
  } else {
    lines.push(...issueTable(issues))
  }
  lines.push('')

  const agentEntries = Object.entries(report.agentResults ?? {})
  if (agentEntries.length > 0) {
    lines.push('## 各维度发现')
    lines.push('')
    for (const [dimension, result] of agentEntries) {
      const list = result?.issues ?? []
      lines.push(`### ${dimension}（${list.length} 个问题，评分 ${result?.score ?? 0}）`)
      lines.push('')
      lines.push(...(list.length === 0 ? ['该维度未发现问题。'] : issueTable(list)))
      lines.push('')
    }
  }

  const statusEntries = Object.entries(report.reviewStatus ?? {})
  if (statusEntries.length > 0) {
    lines.push('## 审查状态')
    lines.push('')
    for (const [role, status] of statusEntries) {
      const label =
        status === 'success' ? '正常' : status === 'fallback' ? '降级为规则引擎' : '执行失败'
      lines.push(`- ${role}：${label}`)
    }
    lines.push('')
  }

  if (report.governance) {
    lines.push('## 治理信息')
    lines.push('')
    lines.push(`- 工具调用：${report.governance.toolCalls} 次`)
    lines.push(`- 重复调用熔断：${report.governance.loopBreaks} 次`)
    lines.push(`- token 预算降级：${report.governance.budgetExceeded ? '已触发' : '未触发'}`)
    lines.push('')
  }

  lines.push('---')
  lines.push('')
  lines.push('由 code-agent-review 自动生成。')
  return lines.join('\n')
}
