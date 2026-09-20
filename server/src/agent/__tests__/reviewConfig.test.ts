import { describe, expect, it, vi } from 'vitest'
import type { Issue } from '../../../../shared/types'

// consumer 依赖 db / queue 模块，这里只需其纯函数，故把重依赖替换为空实现
vi.mock('../../db/queries', () => ({}))
vi.mock('../../services/taskService', () => ({}))
vi.mock('../../services/eventService', () => ({}))

import { applyReviewConfig, resolveReviewerRoles } from '../orchestrator'
import { buildReviewCacheKey, serializeReviewConfig } from '../../queue/consumer'

const issues: Issue[] = [
  { line: 10, severity: 'critical', category: 'A', message: 'a', suggestion: '' },
  { line: 2, severity: 'suggestion', category: 'B', message: 'b', suggestion: '' },
  { line: 5, severity: 'warning', category: 'C', message: 'c', suggestion: '' },
  { line: 1, severity: 'warning', category: 'D', message: 'd', suggestion: '' }
]

describe('resolveReviewerRoles（REQ-14）', () => {
  it('未指定维度时返回全部四个维度', () => {
    expect(resolveReviewerRoles()).toEqual(['security', 'performance', 'style', 'logic'])
    expect(resolveReviewerRoles({})).toEqual(['security', 'performance', 'style', 'logic'])
    expect(resolveReviewerRoles({ dimensions: [] })).toEqual([
      'security',
      'performance',
      'style',
      'logic'
    ])
  })

  it('只返回请求指定的维度，且顺序固定', () => {
    expect(resolveReviewerRoles({ dimensions: ['logic', 'security'] })).toEqual([
      'security',
      'logic'
    ])
  })
})

describe('applyReviewConfig（REQ-14）', () => {
  it('无配置时原样返回', () => {
    expect(applyReviewConfig(issues)).toBe(issues)
  })

  it('按 severityThreshold 过滤低严重度问题', () => {
    const result = applyReviewConfig(issues, { severityThreshold: 'warning' })
    expect(result.map(issue => issue.severity)).toEqual(['critical', 'warning', 'warning'])
  })

  it('severityThreshold=critical 时只保留高危', () => {
    const result = applyReviewConfig(issues, { severityThreshold: 'critical' })
    expect(result).toHaveLength(1)
    expect(result[0].category).toBe('A')
  })

  it('按 maxIssues 截断，且先严重度后行号排序', () => {
    const result = applyReviewConfig(issues, { maxIssues: 2 })
    expect(result.map(issue => issue.category)).toEqual(['A', 'D'])
  })

  it('过滤与截断可以组合生效', () => {
    const result = applyReviewConfig(issues, { severityThreshold: 'warning', maxIssues: 2 })
    expect(result.map(issue => issue.category)).toEqual(['A', 'D'])
  })
})

describe('审查配置参与缓存键（REQ-14）', () => {
  it('字段顺序与维度顺序归一后一致', () => {
    const a = serializeReviewConfig({ dimensions: ['logic', 'security'], maxIssues: 3 })
    const b = serializeReviewConfig({ maxIssues: 3, dimensions: ['security', 'logic'] })
    expect(a).toBe(b)
  })

  it('配置相同则缓存键相同', () => {
    expect(buildReviewCacheKey('code', 'ts', 'model', { maxIssues: 3 })).toBe(
      buildReviewCacheKey('code', 'ts', 'model', { maxIssues: 3 })
    )
  })

  it('配置不同则缓存键不同，未配置也与已配置不同', () => {
    const base = buildReviewCacheKey('code', 'ts', 'model')
    const withConfig = buildReviewCacheKey('code', 'ts', 'model', { maxIssues: 3 })
    const other = buildReviewCacheKey('code', 'ts', 'model', { maxIssues: 5 })
    const dimensions = buildReviewCacheKey('code', 'ts', 'model', { dimensions: ['security'] })

    expect(base).not.toBe(withConfig)
    expect(withConfig).not.toBe(other)
    expect(withConfig).not.toBe(dimensions)
  })
})
