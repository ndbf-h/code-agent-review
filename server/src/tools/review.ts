import * as acorn from 'acorn'
import type { Tool } from '../agent/tool-registry'
import { scanCode, getRulesByDimension } from './rules'

/** 真实代码分析工具 */
const analyzeCode: Tool = {
  definition: {
    name: 'analyzeCode',
    description: '分析代码在指定维度（security/performance/style/logic）上的问题',
    parameters: {
      code: { type: 'string', description: '待分析的代码' },
      dimension: { type: 'string', description: '审查维度：security、performance、style、logic' }
    }
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const code = input.code as string
    const dimension = (input.dimension as string) || 'security'

    const rules = getRulesByDimension(dimension)
    const matches = scanCode(code, rules)

    // 统计各严重度数量并计算评分
    const criticalCount = matches.filter(m => m.severity === 'critical').length
    const warningCount = matches.filter(m => m.severity === 'warning').length
    const suggestionCount = matches.filter(m => m.severity === 'suggestion').length
    const score = Math.max(0, 100 - criticalCount * 15 - warningCount * 8 - suggestionCount * 3)

    const issues = matches.map(m => ({
      line: m.line,
      severity: m.severity,
      category: m.category,
      message: m.message,
      suggestion: m.suggestion
    }))

    return JSON.stringify({ issues, score })
  }
}

/** 模式检查工具 */
const checkPattern: Tool = {
  definition: {
    name: 'checkPattern',
    description:
      '按特定模式或规则检查代码（sql_injection、xss、naming、null_check、sync_block 等）',
    parameters: {
      code: { type: 'string', description: '待检查的代码' },
      pattern: { type: 'string', description: '检查模式' }
    }
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const code = input.code as string
    const pattern = (input.pattern as string) || ''

    // 映射 pattern 到维度
    const dimensionMap: Record<string, string> = {
      sql_injection: 'security',
      xss: 'security',
      null_check: 'logic',
      naming: 'style',
      sync_block: 'performance'
    }

    const dimension = dimensionMap[pattern] || 'security'
    const rules = getRulesByDimension(dimension)
    const allMatches = scanCode(code, rules)

    // 进一步按 pattern 过滤
    const categoryMap: Record<string, string> = {
      sql_injection: 'SQL 注入',
      xss: 'XSS',
      null_check: '空值',
      naming: '命名',
      sync_block: '阻塞'
    }
    const targetCategory = categoryMap[pattern]
    const filtered = targetCategory
      ? allMatches.filter(m => m.category.includes(targetCategory))
      : allMatches

    return JSON.stringify({
      matches: filtered.map(m => ({ line: m.line, pattern: m.category, description: m.message })),
      count: filtered.length
    })
  }
}

/** 复杂度检查工具 */
const checkComplexity: Tool = {
  definition: {
    name: 'checkComplexity',
    description: '计算代码的圈复杂度、嵌套深度和行数统计',
    parameters: {
      code: { type: 'string', description: '待分析的代码' }
    }
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const code = (input.code as string) || ''
    const lines = code.split('\n')

    // 圈复杂度：统计分支关键字
    const branchPattern = /\b(if|for|while|case|catch|else\s+if|\?\?|&&|\|\|)\b/gi
    let cyclomaticComplexity = 1 // 基础复杂度 = 1
    while (branchPattern.exec(code) !== null) {
      cyclomaticComplexity++
    }
    branchPattern.lastIndex = 0

    // 最大嵌套深度
    let maxNesting = 0
    let currentNesting = 0
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('}') || trimmed.startsWith(')')) {
        currentNesting = Math.max(0, currentNesting - 1)
      }
      if (/\{\s*$/.test(trimmed) || /\(\s*$/.test(trimmed)) {
        currentNesting++
        maxNesting = Math.max(maxNesting, currentNesting)
      }
    }

    // 热点函数（行内识别 function/=> 后的代码块长度）
    const hotSpots: { line: number; complexity: number }[] = []
    let inFunction = false
    let funcStart = 0
    let funcComplexity = 1

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (/\bfunction\b|=>\s*\{/.test(line)) {
        inFunction = true
        funcStart = i + 1
        funcComplexity = 1
      }
      if (inFunction && branchPattern.test(line)) {
        funcComplexity++
      }
      if (inFunction && line === '}') {
        if (funcComplexity > 3) {
          hotSpots.push({ line: funcStart, complexity: funcComplexity })
        }
        inFunction = false
      }
    }
    branchPattern.lastIndex = 0

    return JSON.stringify({
      lineCount: lines.length,
      cyclomaticComplexity,
      maxNesting,
      hotSpots: hotSpots.slice(0, 10) // 最多 10 个热点
    })
  }
}

/** 语法验证工具 */
const validateSyntax: Tool = {
  definition: {
    name: 'validateSyntax',
    description: '检查代码语法（JavaScript/TypeScript 支持 AST 级验证，其他语言使用启发式方法）',
    parameters: {
      code: { type: 'string', description: '待验证的代码' },
      language: { type: 'string', description: '编程语言' }
    }
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const code = (input.code as string) || ''
    const language = (input.language as string) || 'javascript'

    // JS/TS 场景尝试用 acorn 解析
    if (
      language === 'javascript' ||
      language === 'typescript' ||
      language === 'jsx' ||
      language === 'tsx'
    ) {
      try {
        // acorn 只解析标准 ECMAScript；TS 语法由调用方按错误信息自行判断
        const options: acorn.Options = { ecmaVersion: 'latest', sourceType: 'module' }
        acorn.parse(code, options)
        return JSON.stringify({ valid: true, errors: [] })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown syntax error'
        // 从错误消息中提取行号
        const lineMatch = message.match(/\((\d+):(\d+)\)/)
        return JSON.stringify({
          valid: false,
          errors: [{ line: lineMatch ? parseInt(lineMatch[1]) : 1, message }]
        })
      }
    }

    // 其他语言：启发式检查
    const heuristics: { line: number; message: string }[] = []
    const lines = code.split('\n')
    let braceDepth = 0
    let parenDepth = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line || line.startsWith('//') || line.startsWith('#')) continue

      braceDepth += (line.match(/\{/g) || []).length
      braceDepth -= (line.match(/\}/g) || []).length
      parenDepth += (line.match(/\(/g) || []).length
      parenDepth -= (line.match(/\)/g) || []).length
    }

    if (braceDepth !== 0) {
      heuristics.push({
        line: lines.length,
        message: `大括号不匹配（差 ${Math.abs(braceDepth)} 个）`
      })
    }
    if (parenDepth !== 0) {
      heuristics.push({
        line: lines.length,
        message: `圆括号不匹配（差 ${Math.abs(parenDepth)} 个）`
      })
    }

    return JSON.stringify({
      valid: heuristics.length === 0,
      errors: heuristics
    })
  }
}

export { analyzeCode, checkPattern, checkComplexity, validateSyntax }
