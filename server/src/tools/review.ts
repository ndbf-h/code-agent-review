import type { Tool } from '../agent/tool-registry'

const analyzeCode: Tool = {
  definition: {
    name: 'analyzeCode',
    description: '分析代码在指定维度上的问题',
    parameters: {
      code: { type: 'string', description: '待分析的代码' },
      dimension: { type: 'string', description: '审查维度：security、performance、style、logic' }
    }
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const dimension = input.dimension as string

    const mockResults: Record<string, object> = {
      security: {
        issues: [
          { line: 3, severity: 'critical', category: 'SQL 注入', message: 'SQL 查询中使用了字符串拼接', suggestion: '使用参数化查询替代字符串拼接' }
        ],
        score: 60
      },
      performance: {
        issues: [
          { line: 4, severity: 'warning', category: '查询优化', message: '函数内数据库查询可能导致 N+1 问题', suggestion: '考虑批量查询' }
        ],
        score: 80
      },
      style: {
        issues: [
          { line: 1, severity: 'suggestion', category: '类型注解', message: '缺少参数类型声明', suggestion: '添加类型注解' },
          { line: 1, severity: 'suggestion', category: '命名规范', message: '函数名不够清晰', suggestion: '使用更具体的名称' }
        ],
        score: 70
      },
      logic: {
        issues: [
          { line: 2, severity: 'critical', category: '空值检查', message: '参数可能为 null', suggestion: '添加 null 检查' }
        ],
        score: 75
      }
    }

    return JSON.stringify(mockResults[dimension] || { issues: [], score: 100 })
  }
}

const checkPattern: Tool = {
  definition: {
    name: 'checkPattern',
    description: '按特定模式或规则检查代码',
    parameters: {
      code: { type: 'string', description: '待检查的代码' },
      pattern: { type: 'string', description: '检查模式：sql_injection、xss、naming、null_check' }
    }
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const pattern = input.pattern as string

    const mockResults: Record<string, object> = {
      sql_injection: { matches: [{ line: 3, pattern: '字符串拼接 SQL', description: '用户输入直接拼接到 SQL 字符串中' }], count: 1 },
      xss: { matches: [], count: 0 },
      naming: { matches: [{ line: 1, pattern: '命名过短', description: "函数名 'getUser' 可以更具体" }], count: 1 },
      null_check: { matches: [{ line: 2, pattern: '缺少空值检查', description: '使用参数前未检查 null/undefined' }], count: 1 }
    }

    return JSON.stringify(mockResults[pattern] || { matches: [], count: 0 })
  }
}

const validateLogic: Tool = {
  definition: {
    name: 'validateLogic',
    description: '验证代码逻辑并检查边界条件',
    parameters: {
      code: { type: 'string', description: '待验证的代码' }
    }
  },
  async execute(_input: Record<string, unknown>): Promise<string> {
    return JSON.stringify({
      edgeCases: ['null 输入', 'undefined 输入', '空字符串输入', '非字符串输入', 'SQL 注入攻击'],
      covered: [false, false, false, false, false],
      suggestions: [
        '在函数入口添加 null 检查',
        '添加 id 参数的类型检查',
        '使用参数化查询防止 SQL 注入'
      ]
    })
  }
}

export { analyzeCode, checkPattern, validateLogic }
