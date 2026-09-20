import { describe, expect, it } from 'vitest'
import { renderReportMarkdown } from '../markdown'
import { languageExtension, renderSarif } from '../sarif'
import type { ReportContent, Task } from '../../../../shared/types'

const task: Task = {
  id: 'task-1',
  title: '示例审查',
  codeSnippet: 'const a = 1',
  language: 'typescript',
  status: 'completed',
  createdAt: '2026-09-20T10:00:00.000Z',
  scopeId: 'scope-1'
}

const report: ReportContent = {
  issues: [
    {
      line: 2,
      severity: 'critical',
      category: 'SQL 注入',
      message: '存在 | 竖线需要转义',
      suggestion: '使用参数化查询'
    },
    { line: 0, severity: 'suggestion', category: '命名规范', message: '命名不清晰', suggestion: '' }
  ],
  score: 55,
  agentResults: {
    security: {
      issues: [
        {
          line: 2,
          severity: 'critical',
          category: 'SQL 注入',
          message: '字符串拼接',
          suggestion: '参数化'
        }
      ],
      score: 40
    },
    style: { issues: [], score: 90 }
  },
  reviewStatus: { security: 'success', style: 'fallback' },
  security: { injectionSuspected: true, findings: [] },
  governance: { loopBreaks: 1, toolCalls: 5, budgetExceeded: false }
}

describe('renderReportMarkdown（REQ-13）', () => {
  it('输出标题、评分、严重度统计与问题表', () => {
    const md = renderReportMarkdown(task, report)
    expect(md).toContain('# 代码审查报告：示例审查')
    expect(md).toContain('55 / 100（较差）')
    expect(md).toContain('| 高危 | 1 |')
    expect(md).toContain('| 建议 | 1 |')
    expect(md).toContain('## 最终问题清单')
    expect(md).toContain('使用参数化查询')
  })

  it('转义表格中的竖线', () => {
    const md = renderReportMarkdown(task, report)
    expect(md).toContain('存在 \\| 竖线需要转义')
  })

  it('非法行号回退为 1', () => {
    const md = renderReportMarkdown(task, report)
    expect(md).toContain('| 1 | 建议 | 命名规范 |')
  })

  it('包含维度明细、降级状态、治理与注入提示', () => {
    const md = renderReportMarkdown(task, report)
    expect(md).toContain('## 各维度发现')
    expect(md).toContain('### style（0 个问题，评分 90）')
    expect(md).toContain('该维度未发现问题。')
    expect(md).toContain('style：降级为规则引擎')
    expect(md).toContain('重复调用熔断：1 次')
    expect(md).toContain('疑似提示注入内容')
  })

  it('空问题列表输出"未发现问题"', () => {
    const md = renderReportMarkdown(task, { issues: [], score: 100, agentResults: {} })
    expect(md).toContain('未发现问题。')
  })
})

describe('renderSarif（REQ-13）', () => {
  it('输出 SARIF 2.1.0 骨架与驱动信息', () => {
    const log = renderSarif(task, report)
    expect(log.version).toBe('2.1.0')
    expect(log.$schema).toContain('sarif-2.1.0')
    expect(log.runs[0].tool.driver.name).toBe('code-agent-review')
    expect(log.runs[0].tool.driver.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('rules 按分类去重', () => {
    const log = renderSarif(task, report)
    const ids = log.runs[0].tool.driver.rules.map(rule => rule.id)
    expect(ids).toEqual(['SQL 注入', '命名规范'])
  })

  it('严重度映射到 SARIF level，非法行号回退为 1', () => {
    const log = renderSarif(task, report)
    const [first, second] = log.runs[0].results
    expect(first.level).toBe('error')
    expect(second.level).toBe('note')
    expect(second.locations[0].physicalLocation.region.startLine).toBe(1)
  })

  it('文件 URI 按语言映射扩展名', () => {
    const log = renderSarif(task, report)
    expect(log.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri).toBe(
      'snippet.ts'
    )
    expect(languageExtension('javascript')).toBe('js')
    expect(languageExtension('unknown-lang')).toBe('txt')
  })
})
