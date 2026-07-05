import { describe, it, expect } from 'vitest'

describe('Client placeholder', () => {
  it('should verify jsdom environment works', () => {
    expect(typeof window).toBe('object')
    expect(typeof document).toBe('object')
  })
})
