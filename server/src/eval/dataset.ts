import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 解析并校验 jsonl 文本（纯函数，便于单测）。
 * 任何一行格式非法都立即抛错并指明行号——评测数据宁可失败也不能静默错读。
 */
export function parseJsonl<T>(content: string, validate: (row: unknown, lineNo: number) => T): T[] {
  const rows: T[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('//')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      throw new Error(`数据集第 ${i + 1} 行 JSON 解析失败: ${error instanceof Error ? error.message : error}`)
    }
    rows.push(validate(parsed, i + 1))
  }
  return rows
}

export function loadJsonl<T>(filePath: string, validate: (row: unknown, lineNo: number) => T): T[] {
  const content = readFileSync(resolve(filePath), 'utf-8')
  return parseJsonl(content, validate)
}

function asRecord(row: unknown, lineNo: number): Record<string, unknown> {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new Error(`数据集第 ${lineNo} 行应为 JSON 对象`)
  }
  return row as Record<string, unknown>
}

function requireString(row: Record<string, unknown>, key: string, lineNo: number): string {
  const value = row[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`数据集第 ${lineNo} 行缺少必填字段 "${key}"`)
  }
  return value
}

const DIMENSIONS = ['security', 'performance', 'style', 'logic']

export function validateReviewSample(row: unknown, lineNo: number) {
  const record = asRecord(row, lineNo)
  const tier = requireString(record, 'tier', lineNo)
  if (!['easy', 'tricky', 'adversarial'].includes(tier)) {
    throw new Error(`数据集第 ${lineNo} 行 tier 非法: ${tier}`)
  }
  const expected = record.expectedIssues
  if (!Array.isArray(expected) || expected.length === 0) {
    throw new Error(`数据集第 ${lineNo} 行 expectedIssues 必须为非空数组`)
  }
  for (const item of expected) {
    const e = asRecord(item, lineNo)
    if (!DIMENSIONS.includes(String(e.dimension))) {
      throw new Error(`数据集第 ${lineNo} 行期望问题 dimension 非法: ${String(e.dimension)}`)
    }
    if (typeof e.category !== 'string' && typeof e.keyword !== 'string') {
      throw new Error(`数据集第 ${lineNo} 行期望问题必须提供 category 或 keyword 至少其一`)
    }
  }
  return {
    id: requireString(record, 'id', lineNo),
    tier: tier as 'easy' | 'tricky' | 'adversarial',
    language: requireString(record, 'language', lineNo),
    title: typeof record.title === 'string' ? record.title : undefined,
    code: requireString(record, 'code', lineNo),
    expectedIssues: expected as Array<{ dimension: 'security' | 'performance' | 'style' | 'logic'; category?: string; keyword?: string; note?: string }>
  }
}

const RAG_QUERY_TYPES = ['exact-english', 'paraphrase-english', 'chinese-only', 'code-snippet', 'dimension-filtered']

export function validateRagQuery(row: unknown, lineNo: number) {
  const record = asRecord(row, lineNo)
  const type = requireString(record, 'type', lineNo)
  if (!RAG_QUERY_TYPES.includes(type)) {
    throw new Error(`数据集第 ${lineNo} 行 RAG 查询 type 非法: ${type}`)
  }
  const expected = record.expectedDocIds
  if (!Array.isArray(expected) || expected.length === 0 || !expected.every(id => typeof id === 'string')) {
    throw new Error(`数据集第 ${lineNo} 行 expectedDocIds 必须为非空字符串数组`)
  }
  return {
    id: requireString(record, 'id', lineNo),
    type: type as 'exact-english' | 'paraphrase-english' | 'chinese-only' | 'code-snippet' | 'dimension-filtered',
    query: requireString(record, 'query', lineNo),
    language: typeof record.language === 'string' ? record.language : undefined,
    dimension: typeof record.dimension === 'string' ? record.dimension : undefined,
    expectedDocIds: expected as string[],
    note: typeof record.note === 'string' ? record.note : undefined
  }
}
