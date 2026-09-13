import { describe, it, expect } from 'vitest'
import { decideClaim } from '../queries'

describe('decideClaim 消息抢占决策', () => {
  it('pending 任务可抢占执行', () => {
    expect(decideClaim('pending')).toBe('claim')
  })

  it('orchestrating 任务正在别处执行，跳过等待 sweeper 兜底', () => {
    expect(decideClaim('orchestrating')).toBe('running')
  })

  it('终态任务（completed/failed/cancelled）为重复投递，幂等吸收', () => {
    expect(decideClaim('completed')).toBe('terminal')
    expect(decideClaim('failed')).toBe('terminal')
    expect(decideClaim('cancelled')).toBe('terminal')
  })

  it('任务不存在按终态处理（直接 ack 丢弃消息）', () => {
    expect(decideClaim(undefined)).toBe('terminal')
  })
})
