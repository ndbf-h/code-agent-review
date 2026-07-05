// server/src/tools/rules/types.ts

export type RuleSeverity = 'critical' | 'warning' | 'suggestion'

export interface Rule {
  name: string
  /** 正则或字符串匹配模式 */
  pattern: RegExp
  severity: RuleSeverity
  category: string
  /** 问题描述（可基于匹配结果动态生成） */
  message: string | ((match: RegExpMatchArray) => string)
  /** 修复建议 */
  suggestion: string
  /** 适用的语言列表，空数组表示所有语言 */
  languages?: string[]
}

export interface RuleMatch {
  line: number
  column: number
  severity: RuleSeverity
  category: string
  message: string
  suggestion: string
  /** 匹配到的具体文本 */
  snippet: string
}

/** 对代码按行扫描所有规则 */
export function scanCode(code: string, rules: Rule[], language?: string): RuleMatch[] {
  const matches: RuleMatch[] = []

  for (const rule of rules) {
    // 语言过滤
    if (rule.languages && rule.languages.length > 0 && language && !rule.languages.includes(language)) {
      continue
    }

    // 全局正则扫描（跨行模式也支持）
    // 重置正则的 lastIndex，避免全局状态污染
    rule.pattern.lastIndex = 0

    let execResult: ReturnType<typeof rule.pattern.exec>
    while ((execResult = rule.pattern.exec(code)) !== null) {
      const matchIndex = execResult.index
      const matchText = execResult[0]

      // 计算匹配位置对应的行号
      const beforeMatch = code.substring(0, matchIndex)
      const line = beforeMatch.split('\n').length
      const lastNewline = beforeMatch.lastIndexOf('\n')
      const column = matchIndex - lastNewline

      const message = typeof rule.message === 'function'
        ? rule.message(execResult)
        : rule.message

      matches.push({
        line,
        column,
        severity: rule.severity,
        category: rule.category,
        message,
        suggestion: rule.suggestion,
        snippet: code.substring(matchIndex, Math.min(matchIndex + matchText.length + 40, code.length)).split('\n')[0]
      })

      // 防止无限循环（零长度匹配）
      if (matchIndex === rule.pattern.lastIndex) {
        rule.pattern.lastIndex++
      }
    }
  }

  // 按行号排序
  matches.sort((a, b) => a.line - b.line || a.column - b.column)
  return matches
}
