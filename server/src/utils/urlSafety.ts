import dns from 'node:dns'
import { isIPv4, isIPv6 } from 'node:net'

function ipv4Number(ip: string): number | null {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null
  }
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
}

function inIpv4Range(value: number, start: string, end: string): boolean {
  const startValue = ipv4Number(start)
  const endValue = ipv4Number(end)
  return startValue !== null && endValue !== null && value >= startValue && value <= endValue
}

function parseIpv6(ip: string): number[] | null {
  let value = ip.toLowerCase()
  if (value.includes('%')) return null

  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':')
    const ipv4 = lastColon >= 0 ? ipv4Number(value.slice(lastColon + 1)) : null
    if (ipv4 === null) return null
    const high = (ipv4 >>> 16).toString(16)
    const low = (ipv4 & 0xffff).toString(16)
    value = `${value.slice(0, lastColon)}:${high}:${low}`
  }

  const sections = value.split('::')
  if (sections.length > 2) return null

  const left = sections[0] ? sections[0].split(':') : []
  const right = sections.length === 2 && sections[1] ? sections[1].split(':') : []
  const groupCount = left.length + right.length
  if (sections.length === 1 && groupCount !== 8) return null
  if (sections.length === 2 && groupCount >= 8) return null

  const groups =
    sections.length === 2 ? [...left, ...Array(8 - groupCount).fill('0'), ...right] : left

  const parsed = groups.map(group => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : -1))
  return parsed.length === 8 && parsed.every(group => group >= 0) ? parsed : null
}

export function isPrivateIp(ip: string): boolean {
  const value = ip.trim().toLowerCase()

  if (isIPv4(value)) {
    const number = ipv4Number(value)
    if (number === null) return true

    return (
      inIpv4Range(number, '0.0.0.0', '0.255.255.255') ||
      inIpv4Range(number, '10.0.0.0', '10.255.255.255') ||
      inIpv4Range(number, '100.64.0.0', '100.127.255.255') ||
      inIpv4Range(number, '127.0.0.0', '127.255.255.255') ||
      inIpv4Range(number, '169.254.0.0', '169.254.255.255') ||
      inIpv4Range(number, '172.16.0.0', '172.31.255.255') ||
      inIpv4Range(number, '192.0.0.0', '192.0.0.255') ||
      inIpv4Range(number, '192.0.2.0', '192.0.2.255') ||
      inIpv4Range(number, '192.168.0.0', '192.168.255.255') ||
      inIpv4Range(number, '198.18.0.0', '198.19.255.255') ||
      inIpv4Range(number, '198.51.100.0', '198.51.100.255') ||
      inIpv4Range(number, '203.0.113.0', '203.0.113.255') ||
      inIpv4Range(number, '224.0.0.0', '255.255.255.255')
    )
  }

  if (isIPv6(value)) {
    const groups = parseIpv6(value)
    if (!groups) return true

    const isIpv4Compatible = groups.slice(0, 6).every(group => group === 0)
    if (
      isIpv4Compatible ||
      (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff)
    ) {
      const mapped = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`
      return isPrivateIp(mapped)
    }

    const first = groups[0]
    return (
      groups.every(group => group === 0) ||
      (groups.slice(0, 7).every(group => group === 0) && groups[7] === 1) || // Loopback (::1)
      (first & 0xfe00) === 0xfc00 || // Unique local addresses (fc00::/7)
      (first & 0xffc0) === 0xfe80 || // Link-local addresses (fe80::/10)
      (first & 0xff00) === 0xff00 || // Multicast/reserved addresses
      (groups[0] === 0x2001 && groups[1] === 0x0db8)
    ) // Documentation range
  }

  return true
}

export async function resolveAndCheckIp(hostname: string): Promise<void> {
  const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0) {
    throw new Error('Unable to resolve target hostname')
  }

  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new Error(`Target resolves to a private or reserved address: ${address}`)
    }
  }
}
