// server/src/tools/rules/logic.ts
import type { Rule } from './types'

export const logicRules: Rule[] = [
  {
    name: 'missing-null-check',
    pattern: /(\w+)\.(\w+)\s*\(/g,
    severity: 'warning',
    category: '空值安全',
    message: m => `调用 "${m[1]}.${m[2]}()" 前未对 "${m[1]}" 做空值检查`,
    suggestion: '在访问属性/方法前添加 if (x != null) 检查或使用可选链 x?.method()'
  },
  {
    name: 'try-without-catch',
    pattern: /\btry\s*\{[^}]*\}\s*catch\s*\(\s*\w*\s*\)\s*\{\s*\}/gi,
    severity: 'warning',
    category: '空异常处理',
    message: 'catch 块为空，异常被静默吞掉',
    suggestion: '至少记录错误日志，或根据业务需要做降级处理'
  },
  {
    name: 'unhandled-promise',
    pattern: /\.then\s*\(\s*(?:function|\([^)]*\)\s*=>\s*\{)(?![^)]*\)\s*\.\s*catch\s*\()/gi,
    severity: 'warning',
    category: '未处理 Promise',
    message: 'Promise then 链可能缺少 .catch()',
    suggestion: '添加 .catch() 处理异常，或使用 async/await + try-catch'
  },
  {
    name: 'off-by-one-loop',
    pattern: /for\s*\(\s*\w+\s+\w+\s*=\s*0\s*;\s*\w+\s*<=\s*\w+\.length/gi,
    severity: 'critical',
    category: '越界错误',
    message: '循环条件使用了 <= arr.length，可能导致数组越界',
    suggestion: '改为 < arr.length（0-based 索引），或确认你确实需要 <='
  },
  {
    name: 'array-index-without-check',
    pattern: /(\w+)\[(?!['"])(\w+)\]/g,
    severity: 'suggestion',
    category: '索引安全',
    message: m => `数组 "${m[1]}[${m[2]}]" 访问未做边界检查`,
    suggestion:
      '访问前检查 index >= 0 && index < arr.length，或使用 arr.at(index)（返回 undefined）'
  }
]
