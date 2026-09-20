import pkg from '../../package.json'
import type { Issue, ReportContent, Task } from '../../../shared/types'

/**
 * SARIF 2.1.0 导出（REQ-13）：把审查结果交给 GitHub code scanning、reviewdog 等
 * 消费的标准格式。纯函数实现，不读库不调 LLM。
 */

type SarifLevel = 'error' | 'warning' | 'note'

interface SarifRule {
  id: string
  name: string
  shortDescription: { text: string }
  defaultConfiguration: { level: SarifLevel }
}

interface SarifResult {
  ruleId: string
  level: SarifLevel
  message: { text: string }
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string }
      region: { startLine: number }
    }
  }>
}

export interface SarifLog {
  version: '2.1.0'
  $schema: string
  runs: Array<{
    tool: {
      driver: {
        name: string
        version: string
        informationUri: string
        rules: SarifRule[]
      }
    }
    results: SarifResult[]
  }>
}

const LEVEL_BY_SEVERITY: Record<string, SarifLevel> = {
  critical: 'error',
  warning: 'warning',
  suggestion: 'note'
}

const EXTENSION_BY_LANGUAGE: Record<string, string> = {
  javascript: 'js',
  js: 'js',
  typescript: 'ts',
  ts: 'ts',
  tsx: 'tsx',
  jsx: 'jsx',
  vue: 'vue',
  python: 'py',
  py: 'py',
  go: 'go',
  java: 'java',
  ruby: 'rb',
  php: 'php',
  csharp: 'cs',
  'c#': 'cs',
  cpp: 'cpp',
  'c++': 'cpp',
  c: 'c',
  rust: 'rs',
  kotlin: 'kt',
  swift: 'swift',
  sql: 'sql',
  html: 'html',
  css: 'css',
  scss: 'scss',
  json: 'json',
  yaml: 'yml',
  yml: 'yml',
  shell: 'sh',
  bash: 'sh',
  sh: 'sh'
}

/** 语言名 → 代码片段文件名后缀（未知语言回退 txt） */
export function languageExtension(language: string): string {
  return EXTENSION_BY_LANGUAGE[(language || '').trim().toLowerCase()] ?? 'txt'
}

/** 按问题分类去重生成 SARIF rules */
function buildRules(issues: Issue[]): SarifRule[] {
  const seen = new Map<string, SarifRule>()
  for (const issue of issues) {
    const id = (issue.category || 'unknown').trim() || 'unknown'
    if (seen.has(id)) continue
    seen.set(id, {
      id,
      name: id,
      shortDescription: { text: id },
      defaultConfiguration: { level: LEVEL_BY_SEVERITY[issue.severity] ?? 'warning' }
    })
  }
  return [...seen.values()]
}

export function renderSarif(task: Task, report: ReportContent): SarifLog {
  const issues = report.issues ?? []
  const uri = `snippet.${languageExtension(task.language)}`

  const results: SarifResult[] = issues.map(issue => ({
    ruleId: (issue.category || 'unknown').trim() || 'unknown',
    level: LEVEL_BY_SEVERITY[issue.severity] ?? 'warning',
    message: {
      text: [issue.message, issue.suggestion ? `建议：${issue.suggestion}` : '']
        .filter(Boolean)
        .join(' ')
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri },
          region: { startLine: Number.isFinite(issue.line) && issue.line > 0 ? issue.line : 1 }
        }
      }
    ]
  }))

  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [
      {
        tool: {
          driver: {
            name: 'code-agent-review',
            version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
            informationUri: 'https://github.com/ndbf-h/code-agent-review',
            rules: buildRules(issues)
          }
        },
        results
      }
    ]
  }
}
