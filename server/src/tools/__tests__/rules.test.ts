import { describe, it, expect } from 'vitest'
import { scanCode, securityRules } from '../rules'

describe('Security Rules', () => {
  it('should detect SQL injection via string concat', () => {
    const code = 'const sql = "SELECT * FROM users WHERE id = \'" + userId + "\'"'
    const matches = scanCode(code, securityRules, 'javascript')
    const sqlInjection = matches.filter(m => m.category === 'SQL 注入')
    expect(sqlInjection.length).toBeGreaterThanOrEqual(1)
  })

  it('should detect eval usage', () => {
    const code = 'eval("console.log(1)")'
    const matches = scanCode(code, securityRules)
    const evalMatches = matches.filter(m => m.category === '代码注入')
    expect(evalMatches.length).toBe(1)
  })

  it('should detect hardcoded secrets', () => {
    const code = 'const API_KEY = "sk-1234567890abcdef"'
    const matches = scanCode(code, securityRules)
    const secretMatches = matches.filter(m => m.category === '硬编码密钥')
    expect(secretMatches.length).toBe(1)
  })

  it('should return empty for clean code', () => {
    const code = 'const x = 1 + 2'
    const matches = scanCode(code, securityRules)
    // 允许 suggestion 级别的通用匹配（如 console.log），但不应有高危
    const sqlEval = matches.filter(m => ['SQL 注入', '代码注入', '硬编码密钥'].includes(m.category))
    expect(sqlEval.length).toBe(0)
  })
})
