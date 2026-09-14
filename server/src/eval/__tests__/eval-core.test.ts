import { describe, it, expect } from 'vitest'
import { matchExpectedIssue, evaluateSampleMatch, detectInjectionCompliance } from '../matcher'
import { recallAtK, mrr } from '../metrics'
import { parseJsonl, validateReviewSample, validateRagQuery } from '../dataset'
import type { CodeReviewSample, ReportIssueLike } from '../types'

const issue = (partial: Partial<ReportIssueLike>): ReportIssueLike => ({
  line: 1,
  severity: 'warning',
  category: '',
  message: '',
  suggestion: '',
  ...partial
})

const issuesOf = (dimension: string, issues: ReportIssueLike[]) => ({ [dimension]: issues })

describe('matchExpectedIssue 期望问题匹配', () => {
  it('category 归一化后命中（无空格差异）', () => {
    const issues = issuesOf('security', [issue({ category: 'SQL注入', message: '拼接 SQL' })])
    const result = matchExpectedIssue({ dimension: 'security', category: 'SQL 注入' }, issues)
    expect(result.hit).not.toBeNull()
    expect(result.dimensionMismatch).toBe(false)
  })

  it('同义词组命中（中文类目 vs 英文报告）', () => {
    const issues = issuesOf('security', [
      issue({ category: 'path traversal', message: 'fileName 未校验' })
    ])
    expect(
      matchExpectedIssue({ dimension: 'security', category: '路径遍历' }, issues).hit
    ).not.toBeNull()
  })

  it('category 不中时 keyword 兜底命中（出现在 message 中）', () => {
    const issues = issuesOf('security', [
      issue({ category: '不安全查询', message: '检测到 SQL 拼接，存在注入风险' })
    ])
    expect(
      matchExpectedIssue({ dimension: 'security', keyword: '注入' }, issues).hit
    ).not.toBeNull()
  })

  it('指定维度未命中但其他维度找到 → 命中且标记维度偏差', () => {
    const issues = {
      security: [],
      style: [issue({ category: '错误处理', message: '静默吞掉异常' })]
    }
    const result = matchExpectedIssue({ dimension: 'logic', keyword: '吞' }, issues)
    expect(result.hit).not.toBeNull()
    expect(result.dimensionMismatch).toBe(true)
  })

  it('完全无关的 issue 不命中', () => {
    const issues = issuesOf('style', [issue({ category: '类型安全', message: '使用了 ==' })])
    expect(
      matchExpectedIssue({ dimension: 'security', category: 'SQL 注入', keyword: '注入' }, issues)
        .hit
    ).toBeNull()
  })

  it('空报告不命中', () => {
    expect(matchExpectedIssue({ dimension: 'style', keyword: '命名' }, {}).hit).toBeNull()
  })
})

describe('evaluateSampleMatch 样本匹配聚合', () => {
  const sample: CodeReviewSample = {
    id: 's1',
    tier: 'easy',
    language: 'javascript',
    code: '...',
    expectedIssues: [
      { dimension: 'security', category: 'SQL 注入' },
      { dimension: 'logic', keyword: '空值' }
    ]
  }

  it('命中与额外发现计数正确', () => {
    const agentIssues = {
      security: [issue({ category: 'SQL注入' }), issue({ category: 'XSS 漏洞' })],
      logic: [issue({ category: '边界', message: '循环边界需要显式检查' })]
    }
    const { expectedMatched, extraFindings, dimensionMismatchCount } = evaluateSampleMatch(
      sample,
      agentIssues
    )
    expect(expectedMatched).toEqual([true, false])
    expect(extraFindings).toBe(2)
    expect(dimensionMismatchCount).toBe(0)
  })
})

describe('detectInjectionCompliance 注入服从检测', () => {
  const sample: CodeReviewSample = {
    id: 'adv1',
    tier: 'adversarial',
    language: 'javascript',
    code: '...',
    expectedIssues: [{ dimension: 'security', category: '硬编码密钥' }]
  }

  it('adversarial + 全漏 + 高分 判为疑似服从', () => {
    expect(detectInjectionCompliance(sample, { score: 95, matchedCount: 0 })).toBe(true)
  })

  it('低分不判', () => {
    expect(detectInjectionCompliance(sample, { score: 60, matchedCount: 0 })).toBe(false)
  })

  it('非 adversarial 层不判', () => {
    const easy: CodeReviewSample = { ...sample, tier: 'easy' }
    expect(detectInjectionCompliance(easy, { score: 95, matchedCount: 0 })).toBe(false)
  })
})

describe('检索指标', () => {
  it('recallAtK 手算样例', () => {
    expect(recallAtK(['a', 'b'], ['a', 'c', 'b'], 3)).toBe(1)
    expect(recallAtK(['a', 'b'], ['a', 'c', 'd'], 5)).toBe(0.5)
    expect(recallAtK(['a'], ['b', 'c', 'a'], 2)).toBe(0)
    expect(recallAtK([], ['a'], 5)).toBe(0)
  })

  it('mrr 手算样例', () => {
    expect(mrr(['a'], ['b', 'a', 'c'])).toBe(0.5)
    expect(mrr(['a'], ['a'])).toBe(1)
    expect(mrr(['x'], ['a', 'b'])).toBe(0)
  })
})

describe('parseJsonl 数据集加载', () => {
  it('跳过空行与注释行，正常解析', () => {
    const rows = parseJsonl(
      '// 注释\n{"id":"a"}\n\n{"id":"b"}\n',
      row => (row as { id: string }).id
    )
    expect(rows).toEqual(['a', 'b'])
  })

  it('坏 JSON 行报出行号', () => {
    expect(() => parseJsonl('{"id":"a"}\n{oops}', () => 1)).toThrow(/第 2 行/)
  })

  it('review 样本校验：缺字段报错', () => {
    expect(() =>
      validateReviewSample(
        {
          id: 'x',
          tier: 'easy',
          code: 'c',
          expectedIssues: [{ dimension: 'security', keyword: 'k' }]
        },
        1
      )
    ).toThrow(/language/)
    expect(() =>
      validateReviewSample(
        { id: 'x', tier: 'easy', language: 'js', code: 'c', expectedIssues: [] },
        2
      )
    ).toThrow(/expectedIssues/)
    expect(() =>
      validateReviewSample(
        {
          id: 'x',
          tier: 'easy',
          language: 'js',
          code: 'c',
          expectedIssues: [{ dimension: 'nope', keyword: 'k' }]
        },
        3
      )
    ).toThrow(/dimension/)
  })

  it('rag 查询校验：type 与 expectedDocIds', () => {
    const valid = validateRagQuery(
      {
        id: 'q1',
        type: 'chinese-only',
        query: '如何防注入',
        expectedDocIds: ['security-sql-injection']
      },
      1
    )
    expect(valid.expectedDocIds).toEqual(['security-sql-injection'])
    expect(() =>
      validateRagQuery({ id: 'q2', type: 'unknown', query: 'q', expectedDocIds: ['a'] }, 2)
    ).toThrow(/type/)
    expect(() =>
      validateRagQuery({ id: 'q3', type: 'exact-english', query: 'q', expectedDocIds: [] }, 3)
    ).toThrow(/expectedDocIds/)
  })
})
