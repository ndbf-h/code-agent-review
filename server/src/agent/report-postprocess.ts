import { redactSecrets } from '../security/prompt-guard'
import type { AgentResult, Issue, ReportContent, ReviewConfig } from '../../../shared/types'

/**
 * 报告后处理的唯一入口：所有对外可见的报告（落库、缓存、SSE、导出、PR 评论）
 * 都必须先经过这里，保证脱敏与审查配置覆盖报告的每一层。
 *
 * - 脱敏（REQ-10）：顶层 issues、每个维度的 agentResults[*].issues、注入检测片段；
 * - 严重度过滤（REQ-14）：同时作用于顶层与各维度，避免按维度查看或导出时出现已过滤的问题；
 * - 数量截断（REQ-14）：只截断顶层清单，各维度保留过滤后的完整结果；
 * - 评分不随过滤变化：评分反映代码健康度，隐藏低严重度问题不应让分数虚高。
 *
 * 纯函数且幂等（脱敏掩码与过滤重复执行结果不变），缓存回放时可以安全地再处理一次。
 */
export function finalizeReport(report: ReportContent, reviewConfig?: ReviewConfig): ReportContent {
  const agentResults: Record<string, AgentResult> = {}
  for (const [dimension, result] of Object.entries(report.agentResults ?? {})) {
    agentResults[dimension] = {
      ...result,
      issues: filterBySeverity((result?.issues ?? []).map(redactIssue), reviewConfig)
    }
  }

  const finalized: ReportContent = {
    ...report,
    issues: applyReviewConfig(report.issues.map(redactIssue), reviewConfig),
    agentResults
  }

  if (report.security) {
    finalized.security = {
      ...report.security,
      findings: report.security.findings.map(finding => ({
        ...finding,
        excerpt: redactSecrets(finding.excerpt)
      }))
    }
  }

  return finalized
}

function redactIssue(issue: Issue): Issue {
  return {
    ...issue,
    message: redactSecrets(issue.message),
    suggestion: redactSecrets(issue.suggestion)
  }
}

const SEVERITY_WEIGHT: Record<Issue['severity'], number> = {
  critical: 0,
  warning: 1,
  suggestion: 2
}

/** 过滤掉严重度低于 severityThreshold 的问题 */
function filterBySeverity(issues: Issue[], reviewConfig?: ReviewConfig): Issue[] {
  const thresholdSeverity = reviewConfig?.severityThreshold
  if (!thresholdSeverity) return issues
  const threshold = SEVERITY_WEIGHT[thresholdSeverity] ?? 2
  return issues.filter(issue => (SEVERITY_WEIGHT[issue.severity] ?? 9) <= threshold)
}

/**
 * REQ-14：按审查配置收敛顶层问题列表。
 * 先按 severityThreshold 过滤，再按「严重度 → 行号」排序后用 maxIssues 截断。
 */
export function applyReviewConfig(issues: Issue[], reviewConfig?: ReviewConfig): Issue[] {
  if (!reviewConfig) return issues
  let result = filterBySeverity(issues, reviewConfig)

  if (reviewConfig.maxIssues && reviewConfig.maxIssues > 0) {
    result = [...result]
      .sort((a, b) => SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity] || a.line - b.line)
      .slice(0, reviewConfig.maxIssues)
  }

  return result
}
