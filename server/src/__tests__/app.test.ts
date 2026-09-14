import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../app'
import { parseConfig } from '../config'

// 路由模块会拉起 DB 查询与 LLM 客户端，这里全部替换为空实现，只测中间件层
vi.mock('../db/queries', () => ({}))
vi.mock('../services/taskService', () => ({}))
vi.mock('../services/assistantService', () => ({}))
vi.mock('../services/knowledgeService', () => ({}))
vi.mock('../services/eventService', () => ({}))
vi.mock('../tools/fix', () => ({ applyFixes: { execute: vi.fn() } }))
vi.mock('../agent/llm-client', () => ({
  getTokenUsage: () => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
  getRequestCount: () => 0,
  resetTokenUsage: vi.fn()
}))
vi.mock('../agent/orchestrator', () => ({
  getAgentLatency: () => ({}),
  resetAgentLatency: vi.fn()
}))

const baseEnv: NodeJS.ProcessEnv = {
  LLM_API_KEY: 'sk-test',
  DATABASE_URL: 'postgres://user:pass@db:5432/review',
  RABBITMQ_URL: 'amqp://guest:guest@mq:5672/'
}

function buildApp(
  env: NodeJS.ProcessEnv = {},
  options: Parameters<typeof createApp>[0]['rateLimits'] = undefined
) {
  return createApp({
    config: parseConfig({ ...baseEnv, ...env }),
    health: {
      checkDb: async () => true,
      isRabbitConnected: () => true,
      checkLlm: async () => true
    },
    rateLimits: options
  })
}

describe('createApp 安全加固', () => {
  it('响应带 helmet 安全头且不暴露 X-Powered-By', async () => {
    const res = await request(buildApp()).get('/api/health/live')
    expect(res.status).toBe(200)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBeDefined()
    expect(res.headers['x-powered-by']).toBeUndefined()
    expect(res.headers['content-security-policy']).toBeUndefined()
  })

  it('CORS_ORIGINS=* 时反射任意来源', async () => {
    const res = await request(buildApp())
      .get('/api/health/live')
      .set('Origin', 'https://anything.example')
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  it('白名单模式：命中来源放行，未命中来源不返回 Access-Control-Allow-Origin', async () => {
    const app = buildApp({ CORS_ORIGINS: 'https://app.example,https://admin.example' })
    const allowed = await request(app)
      .get('/api/health/live')
      .set('Origin', 'https://admin.example')
    expect(allowed.headers['access-control-allow-origin']).toBe('https://admin.example')

    const denied = await request(app).get('/api/health/live').set('Origin', 'https://evil.example')
    expect(denied.status).toBe(200)
    expect(denied.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('预检请求放行自定义头 X-API-Key / X-Request-Id / Last-Event-ID', async () => {
    const res = await request(buildApp())
      .options('/api/tasks')
      .set('Origin', 'https://app.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'X-API-Key')
    expect(res.status).toBe(204)
    const allowHeaders = String(res.headers['access-control-allow-headers']).toLowerCase()
    expect(allowHeaders).toContain('x-api-key')
    expect(allowHeaders).toContain('x-request-id')
    expect(allowHeaders).toContain('last-event-id')
  })

  it('超过 MAX_BODY_SIZE 的请求体返回 413 JSON', async () => {
    const app = buildApp({ MAX_BODY_SIZE: '1kb', MAX_CODE_CHARS: '100' })
    const res = await request(app)
      .post('/api/tasks')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ code: 'x'.repeat(2048), language: 'js' }))
    expect(res.status).toBe(413)
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE')
    expect(res.body.error).toContain('1kb')
  })

  it('非法 JSON 返回 400 INVALID_JSON 而非 500', async () => {
    const res = await request(buildApp())
      .post('/api/tasks')
      .set('Content-Type', 'application/json')
      .send('{"code": ')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: '请求体不是合法 JSON', code: 'INVALID_JSON' })
  })

  it('未知路径返回 JSON 404', async () => {
    const res = await request(buildApp()).get('/api/nope')
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NOT_FOUND')
  })

  it('全局限流同样覆盖 /mcp', async () => {
    const app = buildApp({}, { global: { maxRequests: 2, windowMs: 60_000 } })
    const agent = request(app)
    const first = await agent.get('/mcp')
    expect(first.status).toBe(405)
    const second = await agent.get('/mcp')
    expect(second.status).toBe(405)
    const third = await agent.get('/mcp')
    expect(third.status).toBe(429)
    expect(third.body.code).toBe('RATE_LIMITED')
  })

  it('TRUST_PROXY=true 时 req.ip 取自 X-Forwarded-For，限流按真实客户端计数', async () => {
    const app = buildApp({ TRUST_PROXY: 'true' }, { global: { maxRequests: 1, windowMs: 60_000 } })
    const a = await request(app).get('/api/health/live').set('X-Forwarded-For', '203.0.113.1')
    const b = await request(app).get('/api/health/live').set('X-Forwarded-For', '203.0.113.2')
    const aAgain = await request(app).get('/api/health/live').set('X-Forwarded-For', '203.0.113.1')
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(aAgain.status).toBe(429)
  })
})
