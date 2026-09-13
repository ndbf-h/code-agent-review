import { describe, expect, it } from 'vitest'
import { validateGuidelineFile } from '../knowledgeService'

describe('knowledgeService', () => {
  it('accepts supported text guideline files', () => {
    expect(() => validateGuidelineFile('rules.md', '# Rules\nUse parameterized queries')).not.toThrow()
  })

  it('rejects unsupported file types', () => {
    expect(() => validateGuidelineFile('rules.exe', 'content')).toThrow()
  })
})
