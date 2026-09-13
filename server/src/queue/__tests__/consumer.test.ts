import { describe, it, expect } from 'vitest'
import { decideRetry } from '../consumer'

describe('decideRetry 重试额度判定', () => {
  it('首次失败且配置了重试额度时应重试', () => {
    expect(decideRetry(1, 2)).toBe(true)
  })

  it('失败次数达到总尝试上限时不再重试', () => {
    expect(decideRetry(2, 2)).toBe(false)
    expect(decideRetry(3, 2)).toBe(false)
  })

  it('maxAttempts=1 表示不允许任何重试', () => {
    expect(decideRetry(1, 1)).toBe(false)
  })
})
