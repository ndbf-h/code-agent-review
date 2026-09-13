import type { Tool } from '../agent/tool-registry'
import { llmClient } from '../agent/llm-client'

interface FixChange {
  line: number
  description: string
  before: string
  after: string
}

interface FixResult {
  fixedCode: string
  changes: FixChange[]
}

/**
 * applyFixes — 根据审查发现的问题自动修复代码
 * 调用 LLM 逐个处理 issues，只修复问题不改逻辑、不重构、不添加新功能，
 * 返回修复后的完整代码和每处修改的摘要
 */
const applyFixes: Tool = {
  definition: {
    name: 'applyFixes',
    description: '根据审查发现的问题（issues）自动修复代码，返回修复后的完整代码和修改摘要。只修复报告中指出的问题，不重构、不添加新功能',
    parameters: {
      code: { type: 'string', description: '待修复的原始代码' },
      issues: { type: 'string', description: '审查发现的 issues JSON 数组，每项含 line/severity/category/message/suggestion' },
      language: { type: 'string', description: '编程语言（javascript/typescript/python/go/java 等）' }
    }
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const code = (input.code as string) || ''
    const issuesRaw = (input.issues as string) || '[]'
    const language = (input.language as string) || 'javascript'

    let issues: unknown[]
    try {
      issues = JSON.parse(issuesRaw)
      if (!Array.isArray(issues)) {
        issues = []
      }
    } catch {
      return JSON.stringify({
        error: 'issues 参数无法解析为有效的 JSON 数组',
        fixedCode: code,
        changes: []
      })
    }

    if (issues.length === 0) {
      return JSON.stringify({
        fixedCode: code,
        changes: [],
        message: '没有需要修复的问题'
      })
    }

    // 构建 issues 摘要（只传关键字段给 LLM，控制 prompt 长度）
    const issuesSummary = (issues as Record<string, unknown>[]).map((issue) => ({
      line: issue.line,
      severity: issue.severity,
      category: issue.category,
      message: issue.message,
      suggestion: issue.suggestion
    }))

    const schema = {
      fixedCode: 'string - 修复后的完整代码',
      changes: [
        {
          line: 'number - 修改所在行号',
          description: 'string - 修改说明',
          before: 'string - 修改前的代码片段',
          after: 'string - 修改后的代码片段'
        }
      ]
    }

    try {
      const result = await llmClient.chatStructured<FixResult>(
        [
          {
            role: 'system',
            content: [
              '你是一名严谨的代码修复专家。你的任务是仅修复审查报告中指出的问题。',
              '',
              '## 严格约束（必须遵守）',
              '1. **只修复 issues 中列出的问题**，不要改动任何无关代码',
              '2. **不要重构代码**，即使发现可以优化的地方也不要做',
              '3. **不要添加新功能**，不要引入新的变量、函数或依赖',
              '4. **不要修改代码风格**，保持原有的缩进、命名和格式习惯',
              '5. **不要删除任何注释**，除非该注释正是问题所在',
              '6. **保持代码结构不变**，函数顺序、导出方式等不做调整',
              '',
              '## 修复原则',
              '- 每个 issue 的 suggestion 字段包含了修复方向，请参考它来修复',
              '- 如果 suggestion 为空或不明确，根据 message 描述的问题自行判断最安全的修复方式',
              '- 多行修改（如添加空值检查）应合并为一条 change，line 取起始行',
              '- 如果某个 issue 在当前代码中已经不存在（可能已被其他修复覆盖），跳过它',
              '',
              '## 输出格式',
              '返回纯 JSON，不要包含 markdown 代码块标记：',
              '{',
              '  "fixedCode": "修复后的完整代码（必须包含所有行，不要省略任何部分）",',
              '  "changes": [',
              '    {',
              '      "line": 42,',
              '      "description": "添加了空值检查",',
              '      "before": "const name = user.name",',
              '      "after": "const name = user?.name || \'\'"',
              '    }',
              '  ]',
              '}',
              '',
              '**注意**：fixedCode 必须是完整的、可直接使用的代码，不要用 "// ... 其余代码不变" 之类的省略。changes 数组只列出实际做了修改的行，不要包含未修改的内容。'
            ].join('\n')
          },
          {
            role: 'user',
            content: [
              `语言: ${language}`,
              '',
              '## 待修复的问题 (issues)',
              JSON.stringify(issuesSummary, null, 2),
              '',
              '## 原始代码',
              '```',
              code,
              '```',
              '',
              '请根据上述 issues 修复代码，返回修复后的完整代码和修改摘要。'
            ].join('\n')
          }
        ],
        schema
      )

      return JSON.stringify({
        fixedCode: result.fixedCode,
        changes: result.changes || []
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return JSON.stringify({
        error: `LLM 修复调用失败: ${errorMessage}`,
        fixedCode: code,
        changes: []
      })
    }
  }
}

export { applyFixes }
export type { FixResult, FixChange }
