import type { Tool } from '../agent/tool-registry'
import { scanCode, getRulesByDimension } from './rules'

// ═══════════════════════════════════════════════════════════════
// 编排工具 — 全部真实化，不再返回硬编码占位数据
// ═══════════════════════════════════════════════════════════════

/**
 * decomposeTask — 全维度预扫描
 * 对代码运行所有规则引擎维度，返回真实的潜在问题分布，
 * 供 Orchestrator LLM 制定审查策略时参考
 */
const decomposeTask: Tool = {
  definition: {
    name: 'decomposeTask',
    description:
      '对代码进行安全/性能/风格/逻辑四维度预扫描，返回各维度潜在问题数量、评分和重点关注项，用于制定审查策略',
    parameters: {
      code: { type: 'string', description: '待审查的代码' },
      language: {
        type: 'string',
        description: '编程语言（javascript/typescript/python/go/java 等）'
      }
    }
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const code = (input.code as string) || ''
    const language = (input.language as string) || 'javascript'
    const lines = code.split('\n')

    const dimensions = ['security', 'performance', 'style', 'logic'] as const
    const dimLabels: Record<string, string> = {
      security: '安全审查',
      performance: '性能审查',
      style: '代码规范',
      logic: '逻辑审查'
    }

    const scanResults: Record<
      string,
      {
        label: string
        totalIssues: number
        critical: number
        warning: number
        suggestion: number
        score: number
        topIssues: { line: number; severity: string; category: string; message: string }[]
      }
    > = {}

    let grandTotal = 0

    for (const dim of dimensions) {
      const rules = getRulesByDimension(dim)
      const matches = scanCode(code, rules, language)

      const critical = matches.filter(m => m.severity === 'critical').length
      const warning = matches.filter(m => m.severity === 'warning').length
      const suggestion = matches.filter(m => m.severity === 'suggestion').length
      const score = Math.max(0, 100 - critical * 15 - warning * 8 - suggestion * 3)
      grandTotal += matches.length

      scanResults[dim] = {
        label: dimLabels[dim] || dim,
        totalIssues: matches.length,
        critical,
        warning,
        suggestion,
        score,
        topIssues: matches
          .filter(m => m.severity === 'critical' || m.severity === 'warning')
          .slice(0, 8)
          .map(m => ({
            line: m.line,
            severity: m.severity,
            category: m.category,
            message: m.message
          }))
      }
    }

    // 识别热点维度（问题最多的维度）
    const hotDimensions = Object.entries(scanResults)
      .filter(([, v]) => v.critical > 0 || v.warning > 2)
      .sort(([, a], [, b]) => b.critical - a.critical || b.warning - a.warning)
      .map(([k]) => k)

    return JSON.stringify({
      codeStats: {
        lines: lines.length,
        chars: code.length,
        functions: (code.match(/\b(function|def|func|fn|class)\b/g) || []).length
      },
      dimensions: scanResults,
      summary: {
        totalIssuesFound: grandTotal,
        hotDimensions,
        recommendation:
          hotDimensions.length > 0
            ? `建议重点关注 ${hotDimensions.map(d => scanResults[d].label).join('、')} 维度，这些维度预扫描发现问题较多`
            : '各维度预扫描未发现明显高危问题，建议均衡审查'
      }
    })
  }
}

/**
 * assignAgent — 配置维度审查策略
 * 基于预扫描结果为指定维度生成针对性的审查配置，
 * 包含该维度应重点关注的模式和可用的分析工具
 */
const assignAgent: Tool = {
  definition: {
    name: 'assignAgent',
    description: '为指定审查维度配置专门的审查策略，基于预扫描结果生成关注重点和工具推荐',
    parameters: {
      dimension: { type: 'string', description: '审查维度：security、performance、style、logic' },
      preScanFindings: {
        type: 'string',
        description: '该维度的预扫描结果（来自 decomposeTask 的 JSON 片段）'
      },
      language: { type: 'string', description: '编程语言' }
    }
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const dimension = (input.dimension as string) || 'security'
    const language = (input.language as string) || 'javascript'

    // 解析预扫描结果
    let preScanData: {
      critical?: number
      warning?: number
      suggestion?: number
      topIssues?: { line: number; category: string; message: string }[]
    } = {}
    try {
      preScanData = JSON.parse((input.preScanFindings as string) || '{}')
    } catch {
      // 预扫描数据不可解析时使用默认配置
    }

    const criticalCount = preScanData.critical || 0
    const warningCount = preScanData.warning || 0
    const topCategories = preScanData.topIssues?.map(i => i.category) || []

    // 根据维度生成审查策略
    const strategies: Record<
      string,
      {
        tools: string[]
        focusAreas: string[]
        severity: string
        approach: string
      }
    > = {
      security: {
        tools: ['analyzeCode', 'checkPattern', 'validateSyntax'],
        focusAreas: [
          'SQL/NoSQL 注入检测',
          'XSS 跨站脚本漏洞',
          '硬编码密钥/凭证',
          '路径遍历与文件包含',
          '不安全的反序列化',
          '认证与授权缺陷'
        ],
        severity: criticalCount > 0 ? 'high' : 'normal',
        approach:
          criticalCount > 3
            ? '代码中发现多个高危安全问题，建议逐行审查所有外部输入点'
            : '按标准安全审查清单逐项检查'
      },
      performance: {
        tools: ['analyzeCode', 'checkPattern', 'checkComplexity'],
        focusAreas: [
          'N+1 查询与循环内数据库调用',
          '同步阻塞操作（文件/网络）',
          '内存泄漏风险（未清理的监听器/定时器）',
          '不必要的重复计算',
          '大数据集处理策略'
        ],
        severity: warningCount > 3 ? 'high' : 'normal',
        approach:
          warningCount > 3
            ? '检测到多个性能隐患，建议重点审查数据访问层和循环逻辑'
            : '按标准性能审查清单逐项检查'
      },
      style: {
        tools: ['analyzeCode', 'checkPattern', 'checkComplexity'],
        focusAreas: [
          '命名规范（变量/函数/类）',
          '代码结构（函数长度/嵌套深度/文件行数）',
          '注释与文档（JSDoc/导出函数）',
          '魔法数字与硬编码',
          '错误处理模式',
          '调试代码残留'
        ],
        severity: 'normal',
        approach: '按代码规范清单逐项检查，重点关注可读性和一致性'
      },
      logic: {
        tools: ['analyzeCode', 'checkPattern', 'checkComplexity', 'validateSyntax'],
        focusAreas: [
          '空值与 undefined 检查',
          '数组边界与越界访问',
          '异常处理完整性',
          '类型安全与隐式转换',
          '边界条件与极端情况',
          'Promise 错误处理链'
        ],
        severity: 'normal',
        approach: '逐函数审查逻辑完整性，重点关注边界条件和异常路径'
      }
    }

    const strategy = strategies[dimension] || strategies.security

    // 如果有预扫描的具体问题类别，追加到关注区域
    if (topCategories.length > 0) {
      strategy.focusAreas.unshift(`🔴 预扫描命中: ${topCategories.slice(0, 3).join('、')}`)
    }

    return JSON.stringify({
      dimension,
      label:
        {
          security: '安全审查',
          performance: '性能审查',
          style: '代码规范',
          logic: '逻辑审查'
        }[dimension] || dimension,
      language,
      strategy,
      preScanSummary: {
        criticalIssuesFound: criticalCount,
        warningsFound: warningCount,
        suggestionsFound: preScanData.suggestion || 0
      }
    })
  }
}

/**
 * collectResults — 聚合与去重审查结果
 * 合并多个维度的审查发现，去重跨维度重复项，计算综合评分
 */
const collectResults: Tool = {
  definition: {
    name: 'collectResults',
    description: '聚合所有维度的审查结果，对跨维度重复发现进行去重合并，生成综合问题列表',
    parameters: {
      dimensionResults: {
        type: 'string',
        description: '各维度审查结果的 JSON 数组，每项包含 dimension、issues、score'
      }
    }
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    interface DimResult {
      dimension: string
      issues: {
        line: number
        column?: number
        severity: string
        category: string
        message: string
        suggestion: string
      }[]
      score: number
    }

    let results: DimResult[]
    try {
      results = JSON.parse((input.dimensionResults as string) || '[]')
    } catch {
      return JSON.stringify({ error: '无法解析审查结果', mergedIssues: [], overallScore: 0 })
    }

    // 去重：同文件同行号+同类别的合并，保留最严重的一个
    const seenKeys = new Set<string>()
    const mergedIssues: (DimResult['issues'][number] & { dimensions: string[] })[] = []

    for (const dimResult of results) {
      for (const issue of dimResult.issues) {
        const key = `${issue.line}:${issue.category}`
        if (seenKeys.has(key)) {
          // 已存在，更新维度归属
          const existing = mergedIssues.find(i => `${i.line}:${i.category}` === key)
          if (existing && !existing.dimensions.includes(dimResult.dimension)) {
            existing.dimensions.push(dimResult.dimension)
          }
          continue
        }
        seenKeys.add(key)
        mergedIssues.push({ ...issue, dimensions: [dimResult.dimension] })
      }
    }

    // 按严重度 + 行号排序
    const severityOrder: Record<string, number> = { critical: 0, warning: 1, suggestion: 2 }
    mergedIssues.sort((a, b) => {
      const sevDiff = (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99)
      if (sevDiff !== 0) return sevDiff
      return a.line - b.line
    })

    // 综合评分（加权平均，安全权重大于其他维度）
    const weights: Record<string, number> = {
      security: 1.5,
      performance: 1.0,
      style: 0.8,
      logic: 1.2
    }
    let weightedSum = 0
    let totalWeight = 0
    for (const r of results) {
      const w = weights[r.dimension] || 1.0
      weightedSum += r.score * w
      totalWeight += w
    }
    const overallScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0

    return JSON.stringify({
      mergedIssues,
      overallScore,
      dimensionCount: results.length,
      totalIssues: mergedIssues.length,
      critical: mergedIssues.filter(i => i.severity === 'critical').length,
      warning: mergedIssues.filter(i => i.severity === 'warning').length,
      suggestion: mergedIssues.filter(i => i.severity === 'suggestion').length
    })
  }
}

/**
 * generateReport — 生成结构化审查报告
 * 基于聚合后的审查发现，输出包含执行摘要、维度评分、问题清单和修复建议的完整报告
 */
const generateReport: Tool = {
  definition: {
    name: 'generateReport',
    description:
      '基于聚合后的审查发现生成结构化最终报告，包含执行摘要、各维度评分、问题优先级排序和修复路线图',
    parameters: {
      collectionResult: { type: 'string', description: 'collectResults 的输出 JSON' },
      codeStats: { type: 'string', description: '代码统计信息（行数/函数数/语言等）' },
      language: { type: 'string', description: '编程语言' }
    }
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    interface CollectedData {
      mergedIssues: Array<{
        line: number
        severity: string
        category: string
        message: string
        suggestion: string
        dimensions: string[]
      }>
      overallScore: number
      dimensionCount: number
      totalIssues: number
      critical: number
      warning: number
      suggestion: number
    }

    let collection: CollectedData
    try {
      collection = JSON.parse((input.collectionResult as string) || '{}')
    } catch {
      return JSON.stringify({
        reportId: `report-${Date.now()}`,
        score: 0,
        summary: '报告生成失败：无法解析审查结果',
        issues: []
      })
    }

    const language = (input.language as string) || 'unknown'

    // 按维度分组
    const byDimension: Record<string, CollectedData['mergedIssues']> = {}
    for (const issue of collection.mergedIssues || []) {
      for (const dim of issue.dimensions) {
        if (!byDimension[dim]) byDimension[dim] = []
        byDimension[dim].push(issue)
      }
    }

    // 生成执行摘要
    const healthLabel =
      collection.overallScore >= 80 ? '良好' : collection.overallScore >= 60 ? '一般' : '较差'

    const summary =
      collection.totalIssues > 0
        ? `代码健康度 ${healthLabel}（${collection.overallScore}/100），发现 ${collection.totalIssues} 个问题（${collection.critical} 高危、${collection.warning} 警告、${collection.suggestion} 建议）`
        : `代码健康度良好（${collection.overallScore}/100），未发现明显问题`

    return JSON.stringify({
      reportId: `report-${Date.now()}`,
      language,
      score: collection.overallScore,
      summary,
      healthLabel,
      issues: collection.mergedIssues || [],
      issuesByDimension: byDimension,
      counts: {
        total: collection.totalIssues || 0,
        critical: collection.critical || 0,
        warning: collection.warning || 0,
        suggestion: collection.suggestion || 0
      },
      generatedAt: new Date().toISOString()
    })
  }
}

export { decomposeTask, assignAgent, collectResults, generateReport }
