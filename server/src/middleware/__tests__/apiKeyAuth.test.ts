import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import type { Request } from 'express'
import { createApiKeyAuth, extractApiKey } from '../apiKeyAuth'

const TASK_ID = '11111111-1111-1111-1111-111111111111'

/** 用最小 express 应用隔离测试鉴权中间件，避免拉起真实路由依赖 */
function buildApp(apiKeys: string[]) {
  const app = express()
  app.use(createApiKeyAuth({ apiKeys }))
  app.get('/api/health/live', (_req, res) => res.json({ ok: true }))
  app.get('/api/openapi.json', (_req, res) => res.json({ ok: true }))
  app.get('/api/docs', (_req, res) => res.json({ ok: true }))
  app.post('/api/webhooks/github', (_req, res) => res.json({ ok: true }))
  app.get('/api/tasks', (_req, res) => res.json({ ok: true }))
  app.get('/api/tasks/:id/stream', (_req, res) => res.json({ ok: true }))
  app.post('/api/tasks/:id/chat/stream', (_req, res) => res.json({ ok: true }))
  app.post('/mcp', (_req, res) => res.json({ ok: true }))
  return app
}

function fakeReq(
  headers: Record<string, string>,
  query: Record<string, unknown> = {},
  path = '/api/tasks'
): Request {
  return {
    path,
    query,
    get: (name: string) => headers[name.toLowerCase()]
  } as unknown as Request
}

describe('createApiKeyAuth（REQ-12）', () => {
  it('API_KEYS 为空时直接放行', async () => {
    const res = await request(buildApp([])).get('/api/tasks')
    expect(res.status).toBe(200)
  })

  it('X-API-Key 正确放行，错误返回 401', async () => {
    const app = buildApp(['secret-key'])
    expect((await request(app).get('/api/tasks').set('X-API-Key', 'secret-key')).status).toBe(200)

    const bad = await request(app).get('/api/tasks').set('X-API-Key', 'wrong-key')
    expect(bad.status).toBe(401)
    expect(bad.body.code).toBe('UNAUTHORIZED')
  })

  it('Authorization: Bearer 同样可用', async () => {
    const res = await request(buildApp(['secret-key']))
      .get('/api/tasks')
      .set('Authorization', 'Bearer secret-key')
    expect(res.status).toBe(200)
  })

  it('未携带密钥返回 401', async () => {
    const res = await request(buildApp(['secret-key'])).get('/api/tasks')
    expect(res.status).toBe(401)
  })

  it('白名单路径无需鉴权', async () => {
    const app = buildApp(['secret-key'])
    expect((await request(app).get('/api/health/live')).status).toBe(200)
    expect((await request(app).get('/api/openapi.json')).status).toBe(200)
    expect((await request(app).get('/api/docs')).status).toBe(200)
    expect((await request(app).post('/api/webhooks/github')).status).toBe(200)
  })

  it('查询参数传密钥仅对 SSE 路径生效', async () => {
    const app = buildApp(['secret-key'])
    const stream = await request(app).get(`/api/tasks/${TASK_ID}/stream?api_key=secret-key`)
    expect(stream.status).toBe(200)

    const chat = await request(app).post(`/api/tasks/${TASK_ID}/chat/stream?api_key=secret-key`)
    expect(chat.status).toBe(200)

    const list = await request(app).get('/api/tasks?api_key=secret-key')
    expect(list.status).toBe(401)
  })

  it('/mcp 同样受保护', async () => {
    const app = buildApp(['secret-key'])
    expect((await request(app).post('/mcp')).status).toBe(401)
    expect((await request(app).post('/mcp').set('X-API-Key', 'secret-key')).status).toBe(200)
  })
})

describe('extractApiKey', () => {
  it('优先使用 X-API-Key，其次 Bearer', () => {
    expect(extractApiKey(fakeReq({ 'x-api-key': 'from-header' }))).toBe('from-header')
    expect(extractApiKey(fakeReq({ authorization: 'Bearer from-bearer' }))).toBe('from-bearer')
  })

  it('查询参数只在 SSE 路径被接受', () => {
    expect(extractApiKey(fakeReq({}, { api_key: 'q' }, '/api/tasks/x/stream'))).toBe('q')
    expect(extractApiKey(fakeReq({}, { api_key: 'q' }, '/api/tasks'))).toBeNull()
  })

  it('无任何凭据时返回 null', () => {
    expect(extractApiKey(fakeReq({}))).toBeNull()
  })
})
