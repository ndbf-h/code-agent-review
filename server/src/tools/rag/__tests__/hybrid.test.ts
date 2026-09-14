import { describe, it, expect } from 'vitest'
import { tokenizeForSearch } from '../tokenizer'
import { buildBm25Index } from '../bm25'
import { rrfFuse } from '../hybrid-retriever'
import { retrieveGuidelinesHybrid } from '../hybrid-retriever'

describe('tokenizeForSearch CJK 感知分词', () => {
  it('ASCII 词元保留且小写化', () => {
    expect(tokenizeForSearch('SQL Injection Prevention')).toEqual([
      'sql',
      'injection',
      'prevention'
    ])
  })

  it('中文切为二元组', () => {
    expect(tokenizeForSearch('循环查询')).toEqual(['循环', '环查', '查询'])
  })

  it('中英混合各自处理', () => {
    const tokens = tokenizeForSearch('防止 SQL 注入')
    expect(tokens).toContain('sql')
    expect(tokens).toContain('注入')
  })

  it('单个汉字保留原样', () => {
    expect(tokenizeForSearch('空')).toEqual(['空'])
  })
})

describe('buildBm25Index', () => {
  const docs = [
    { id: 'sql', text: 'sql injection parameterized query user input' },
    { id: 'xss', text: 'xss innerhtml sanitize escape html' },
    { id: 'perf', text: 'database query in loop n+1 batch' }
  ]

  it('相关文档得分最高', () => {
    const scores = buildBm25Index(docs).search('sql injection')
    expect(scores.get('sql')! / 1).toBeGreaterThan(scores.get('xss') || 0)
    expect(scores.has('sql')).toBe(true)
  })

  it('无匹配词的文档不出现在结果中（零结果语义）', () => {
    const scores = buildBm25Index(docs).search('样式命名规范')
    expect(scores.size).toBe(0)
  })
})

describe('rrfFuse 融合', () => {
  it('两分支对同一文档投票得分最高', () => {
    const fused = rrfFuse([
      ['a', 'b', 'c'],
      ['b', 'a', 'c']
    ])
    const scoreA = 1 / 61 + 1 / 62
    expect(fused.get('a')).toBeCloseTo(scoreA, 6)
    expect(fused.get('b')!).toBeGreaterThan(fused.get('c')!)
  })

  it('单分支时退化为排名倒数', () => {
    const fused = rrfFuse([['x', 'y']])
    expect(fused.get('x')).toBe(1 / 61)
    expect(fused.get('y')).toBe(1 / 62)
  })
})

describe('retrieveGuidelinesHybrid 词元单分支（未配嵌入密钥）', () => {
  it('英文查询正常召回', async () => {
    const results = await retrieveGuidelinesHybrid({
      code: 'sql injection parameterized query',
      query: 'sql injection parameterized query',
      language: 'javascript',
      topK: 3
    })
    expect(results.map(r => r.id)).toContain('security-sql-injection')
  })

  it('中文查询对英文语料保持零结果（向量分支未开启时的预期行为）', async () => {
    const results = await retrieveGuidelinesHybrid({
      code: '如何防止数据库查询被恶意拼接',
      query: '如何防止数据库查询被恶意拼接',
      language: 'javascript',
      topK: 5
    })
    expect(results).toHaveLength(0)
  })

  it('dimension 过滤与 legacy 语义一致', async () => {
    const results = await retrieveGuidelinesHybrid({
      code: 'naming and comments maintainability',
      query: 'naming and comments maintainability',
      language: 'python',
      dimension: 'style',
      topK: 3
    })
    expect(results.every(r => r.dimension === 'style' || r.dimension === '')).toBe(true)
    expect(results.map(r => r.id)).toContain('style-maintainability')
  })
})
