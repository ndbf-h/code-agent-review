import { describe, it, expect } from 'vitest'
import { toInputSchema, REQUIRED_PARAMS, NON_READONLY_TOOLS } from '../schema'
import { parseMcpServerList } from '../client'

describe('toInputSchema 约定结构 → JSON Schema', () => {
  it('转换 properties 并按手工标注表生成 required', () => {
    const schema = toInputSchema('analyzeCode', {
      code: { type: 'string', description: '待分析的代码' },
      dimension: { type: 'string', description: '维度' }
    })
    expect(schema.type).toBe('object')
    expect(schema.properties.code).toEqual({ type: 'string', description: '待分析的代码' })
    expect(schema.required).toEqual(['code', 'dimension'])
  })

  it('未列入标注表的工具 required 为空（全可选）', () => {
    const schema = toInputSchema('retrieveCodingGuidelines', {
      code: { type: 'string', description: '代码' }
    })
    expect(schema.required).toEqual([])
  })

  it('字段缺 type 时兜底为 string', () => {
    const schema = toInputSchema('checkComplexity', { code: { description: 'x' } })
    expect(schema.properties.code.type).toBe('string')
  })

  it('parameters 为空对象时不抛错', () => {
    const schema = toInputSchema('readFile', {})
    expect(schema.properties).toEqual({})
    expect(schema.required).toEqual(['code'])
  })
})

describe('安全分级标注', () => {
  it('applyFixes（LLM 调用）标为非只读，其余全部只读', () => {
    expect(NON_READONLY_TOOLS.has('applyFixes')).toBe(true)
    for (const name of Object.keys(REQUIRED_PARAMS)) {
      if (name !== 'applyFixes') {
        expect(NON_READONLY_TOOLS.has(name)).toBe(false)
      }
    }
  })
})

describe('parseMcpServerList 服务器列表解析', () => {
  it('未配置时返回空数组', () => {
    expect(parseMcpServerList(undefined)).toEqual([])
    expect(parseMcpServerList('')).toEqual([])
  })

  it('纯 URL 派生别名为 sanitized hostname', () => {
    const [entry] = parseMcpServerList('http://localhost:3001/mcp')
    expect(entry.alias).toBe('localhost')
    expect(entry.url).toBe('http://localhost:3001/mcp')
  })

  it('alias=url 形式优先，非法字符被替换', () => {
    const [entry] = parseMcpServerList('self=http://localhost:3001/mcp, bad host=http://x/y')
    expect(entry.alias).toBe('self')
    expect(entry.url).toBe('http://localhost:3001/mcp')
  })

  it('多个条目逗号分隔', () => {
    const entries = parseMcpServerList('a=http://x/mcp, http://y.example.com/mcp')
    expect(entries).toHaveLength(2)
    expect(entries[1].alias).toBe('y_example_com')
  })
})
