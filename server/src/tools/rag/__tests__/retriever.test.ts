import { describe, expect, it } from 'vitest'
import { retrieveGuidelines } from '../retriever'
import { registerCustomGuidelines } from '../knowledge-base'

describe('RAG guideline retriever', () => {
  it('retrieves security guidance for SQL code', () => {
    const results = retrieveGuidelines({
      language: 'typescript',
      dimension: 'security',
      code: 'const sql = "SELECT * FROM users WHERE id = " + userId'
    })

    expect(results[0]?.id).toBe('security-sql-injection')
    expect(results[0]?.source).toContain('sql-injection')
  })

  it('filters results by review dimension', () => {
    const results = retrieveGuidelines({
      language: 'typescript',
      dimension: 'logic',
      code: 'array index length boundary off by one validation'
    })

    expect(results.every(result => result.dimension === 'logic')).toBe(true)
    expect(results.some(result => result.id === 'logic-boundaries')).toBe(true)
  })

  it('only returns custom guidance inside its scope', () => {
    registerCustomGuidelines([
      {
        id: 'project-only-rule',
        title: 'Project rule',
        dimension: 'security',
        languages: ['typescript'],
        keywords: ['project-only-rule'],
        content: 'Project-only security rule',
        source: 'project-rules.md',
        scopeId: 'scope-a'
      }
    ])

    const inScope = retrieveGuidelines({
      code: 'project-only-rule',
      language: 'typescript',
      scopeId: 'scope-a'
    })
    const outOfScope = retrieveGuidelines({
      code: 'project-only-rule',
      language: 'typescript',
      scopeId: 'scope-b'
    })

    expect(inScope.some(result => result.id === 'project-only-rule')).toBe(true)
    expect(outOfScope.some(result => result.id === 'project-only-rule')).toBe(false)
  })
})
