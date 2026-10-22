import { describe, expect, it } from 'vitest'
import { applyReviewConfig, finalizeReport } from '../report-postprocess'
import type { Issue, ReportContent } from '../../../../shared/types'

const SECRET = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'

function issue(partial: Partial<Issue>): Issue {
  return { line: 1, severity: 'warning', category: 'C', message: '', suggestion: '', ...partial }
}

function baseReport(): ReportContent {
  return {
    issues: [
      issue({ line: 3, severity: 'critical', message: `泄露 ${SECRET}` }),
      issue({ line: 1, severity: 'suggestion', message: '命名' }),
      issue({ line: 2, severity: 'warning', suggestion: `token = "${SECRET}"` })
    ],
    score: 72,
    agentResults: {
      security: {
        score: 60,
        issues: [
          issue({ line: 3, severity: 'critical', message: `泄露 ${SECRET}` }),
          issue({ line: 9, severity: 'suggestion', message: 'x' })
        ]
      },
      style: { score: 90, issues: [issue({ line: 1, severity: 'suggestion', message: '命名' })] }
    },
    reviewStatus: { security: 'success', style: 'success' }
  }
}

function serialized(report: ReportContent): string {
  return JSON.stringify(report)
}

describe('finalizeReport', () => {
  it('顶层与各维度 agentResults 中的密钥都被脱敏', () => {
    const result = finalizeReport(baseReport())
    expect(serialized(result)).not.toContain(SECRET)
    expect(result.agentResults.security.issues[0].message).toContain('ghp_****')
  })

  it('注入检测片段同样脱敏', () => {
    const report = baseReport()
    report.security = {
      injectionSuspected: true,
      findings: [{ line: 1, pattern: 'ignore', excerpt: `ignore ${SECRET}` }]
    }
    expect(serialized(finalizeReport(report))).not.toContain(SECRET)
  })

  it('severityThreshold 同时作用于顶层与各维度', () => {
    const result = finalizeReport(baseReport(), { severityThreshold: 'warning' })
    expect(result.issues.map(i => i.severity)).toEqual(['critical', 'warning'])
    expect(result.agentResults.security.issues).toHaveLength(1)
    expect(result.agentResults.style.issues).toHaveLength(0)
  })

  it('maxIssues 只截断顶层清单，各维度保留完整结果', () => {
    const result = finalizeReport(baseReport(), { maxIssues: 1 })
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].severity).toBe('critical')
    expect(result.agentResults.security.issues).toHaveLength(2)
  })

  it('评分、reviewStatus 等其余字段保持不变', () => {
    const result = finalizeReport(baseReport(), { severityThreshold: 'critical' })
    expect(result.score).toBe(72)
    expect(result.agentResults.security.score).toBe(60)
    expect(result.reviewStatus).toEqual({ security: 'success', style: 'success' })
  })

  it('不修改入参，且重复执行结果一致（缓存回放可安全再处理）', () => {
    const report = baseReport()
    const before = serialized(report)
    const once = finalizeReport(report, { severityThreshold: 'warning', maxIssues: 5 })
    const twice = finalizeReport(once, { severityThreshold: 'warning', maxIssues: 5 })
    expect(serialized(report)).toBe(before)
    expect(twice).toEqual(once)
  })

  it('兼容缺失 agentResults 的旧缓存报告', () => {
    const legacy = { issues: [], score: 80 } as unknown as ReportContent
    expect(finalizeReport(legacy).agentResults).toEqual({})
  })
})

describe('applyReviewConfig', () => {
  it('无配置时原样返回', () => {
    const issues = [issue({})]
    expect(applyReviewConfig(issues)).toBe(issues)
  })
})
