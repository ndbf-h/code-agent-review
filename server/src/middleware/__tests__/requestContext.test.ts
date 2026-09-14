import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import {
  requestContextMiddleware,
  getRequestId,
  normalizeIncomingRequestId
} from '../requestContext'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function buildApp() {
  const app = express()
  app.use(requestContextMiddleware)
  app.get('/echo', async (_req, res) => {
    // 跨 await 仍能取到同一个 requestId
    await new Promise(resolve => setTimeout(resolve, 5))
    res.json({ fromStore: getRequestId(), fromLocals: res.locals.requestId })
  })
  return app
}

describe('请求 ID 中间件', () => {
  it('未携带 X-Request-Id 时生成 UUID，并回写响应头', async () => {
    const res = await request(buildApp()).get('/echo')
    expect(res.status).toBe(200)
    const header = res.headers['x-request-id']
    expect(header).toMatch(UUID_RE)
    expect(res.body.fromStore).toBe(header)
    expect(res.body.fromLocals).toBe(header)
  })

  it('携带合法 X-Request-Id 时原样透传', async () => {
    const res = await request(buildApp()).get('/echo').set('X-Request-Id', 'trace-abc.123_x')
    expect(res.headers['x-request-id']).toBe('trace-abc.123_x')
    expect(res.body.fromStore).toBe('trace-abc.123_x')
  })

  it('非法的 X-Request-Id（含空格 / 过长 / 特殊字符）被丢弃并重新生成', async () => {
    // 含 CR/LF 的值 Node 客户端与服务端 HTTP 解析器都会直接拒绝，无需在此覆盖
    const bad = ['has space', 'x'.repeat(129), '<script>', 'a;b', 'é']
    for (const value of bad) {
      const res = await request(buildApp()).get('/echo').set('X-Request-Id', value)
      expect(res.headers['x-request-id']).toMatch(UUID_RE)
    }
  })

  it('并发请求之间的上下文互不串扰', async () => {
    const app = buildApp()
    const ids = ['req-a', 'req-b', 'req-c']
    const results = await Promise.all(
      ids.map(id => request(app).get('/echo').set('X-Request-Id', id))
    )
    results.forEach((res, index) => {
      expect(res.body.fromStore).toBe(ids[index])
    })
  })

  it('normalizeIncomingRequestId 处理数组头与空白', () => {
    expect(normalizeIncomingRequestId(['  abc  ', 'def'])).toBe('abc')
    expect(normalizeIncomingRequestId(undefined)).toBeUndefined()
    expect(normalizeIncomingRequestId('')).toBeUndefined()
  })

  it('请求上下文之外 getRequestId 返回 undefined', () => {
    expect(getRequestId()).toBeUndefined()
  })
})
