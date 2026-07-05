// server/src/tools/rules/style.ts
import type { Rule } from './types'

export const styleRules: Rule[] = [
  {
    name: 'magic-number',
    pattern: /(?<![a-zA-Z0-9_".'])(\d{2,})(?![a-zA-Z0-9_"])/g,
    severity: 'suggestion',
    category: '魔法数字',
    message: (m) => `发现魔法数字 ${m[1]}，缺少语义说明`,
    suggestion: '将数字提取为命名常量，如 const MAX_RETRIES = 3'
  },
  {
    name: 'long-function',
    pattern: /^/gm, // 占位，实际由 checkComplexity 工具实现
    severity: 'suggestion',
    category: '函数过长',
    message: '函数超过 50 行，建议拆分',
    suggestion: '将函数拆分为多个职责单一的更小函数'
  },
  {
    name: 'missing-comment-export',
    pattern: /^export\s+(async\s+)?function\s+(\w+)[^{]*\{$/gm,
    severity: 'suggestion',
    category: '缺少注释',
    message: (m) => `导出函数 "${m[2]}" 缺少 JSDoc 注释`,
    suggestion: '为导出函数添加 JSDoc 注释，说明参数、返回值和用途'
  },
  {
    name: 'console-log',
    pattern: /console\.(log|warn)\s*\(/gi,
    severity: 'suggestion',
    category: '调试代码',
    message: '代码中遗留了 console.log/warn',
    suggestion: '移除调试日志，或替换为正式的日志框架调用'
  },
  {
    name: 'double-equals',
    pattern: /(?<!=)==(?!=)/g,
    severity: 'suggestion',
    category: '类型安全',
    message: '使用了 == 而非 ===，可能触发隐式类型转换',
    suggestion: '使用 === 进行严格相等比较'
  }
]

// 注意：magic-number 正则会匹配很多误报（代码中的数字常量），需要配合语言上下文使用
// 实际使用时通过分析代码结构（变量声明 vs 计算表达式）来降低误报率
