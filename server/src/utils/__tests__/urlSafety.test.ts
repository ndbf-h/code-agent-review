import { describe, expect, it } from 'vitest'
import { isPrivateIp } from '../urlSafety'

describe('URL target IP safety', () => {
  it.each([
    '0.0.0.1',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1'
  ])('rejects reserved IPv4 address %s', ip => {
    expect(isPrivateIp(ip)).toBe(true)
  })

  it.each(['8.8.8.8', '1.1.1.1'])('allows public IPv4 address %s', ip => {
    expect(isPrivateIp(ip)).toBe(false)
  })

  it.each(['::1', 'fc00::1', 'fe80::1', '::ffff:192.168.1.1', 'ff02::1'])('rejects reserved IPv6 address %s', ip => {
    expect(isPrivateIp(ip)).toBe(true)
  })

  it('allows a public IPv6 address', () => {
    expect(isPrivateIp('2001:4860:4860::8888')).toBe(false)
  })
})
