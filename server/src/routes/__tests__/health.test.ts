import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createHealthRouter, checkReadiness, type HealthDeps } from '../health'

function buildApp(overrides: Partial<HealthDeps> = {}) {
  const deps: HealthDeps = {
    checkDb: vi.fn(async () => true),
    isRabbitConnected: vi.fn(() => true),
    checkLlm: vi.fn(async () => true),
    timeoutMs: 200,
    ...overrides
  }
  const app = express()
  app.use('/api/health', createHealthRouter(deps))
  return { app, deps }
}

describe('健康探针', () => {
  it('/live 不触碰任何依赖，恒为 200', async () => {
    const { app, deps } = buildApp({
      checkDb: vi.fn(async () => {
        throw new Error('db down')
      }),
      isRabbitConnected: vi.fn(() => false)
    })
    const res = await request(app).get('/api/health/live')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(typeof res.body.uptime).toBe('number')
    expect(deps.checkDb).not.toHaveBeenCalled()
    expect(deps.isRabbitConnected).not.toHaveBeenCalled()
  })

  it('/ready 全部就绪返回 200', async () => {
    const { app } = buildApp()
    const res = await request(app).get('/api/health/ready')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok', checks: { db: 'ok', rabbitmq: 'ok' } })
  })

  it('/ready 数据库查询失败返回 503 并标出 db', async () => {
    const { app } = buildApp({
      checkDb: vi.fn(async () => {
        throw new Error('connection refused')
      })
    })
    const res = await request(app).get('/api/health/ready')
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ status: 'degraded', checks: { db: 'fail', rabbitmq: 'ok' } })
  })

  it('/ready 数据库查询超时按失败处理', async () => {
    const { app } = buildApp({
      checkDb: vi.fn(() => new Promise<boolean>(() => undefined)),
      timeoutMs: 50
    })
    const res = await request(app).get('/api/health/ready')
    expect(res.status).toBe(503)
    expect(res.body.checks.db).toBe('fail')
  })

  it('/ready RabbitMQ 断开返回 503 并标出 rabbitmq', async () => {
    const { app } = buildApp({ isRabbitConnected: vi.fn(() => false) })
    const res = await request(app).get('/api/health/ready')
    expect(res.status).toBe(503)
    expect(res.body.checks).toEqual({ db: 'ok', rabbitmq: 'fail' })
  })

  it('/api/health 默认不探测 LLM，?deep=1 时才探测', async () => {
    const { app, deps } = buildApp()
    const plain = await request(app).get('/api/health')
    expect(plain.status).toBe(200)
    expect(plain.body.checks).toEqual({ db: 'ok', rabbitmq: 'ok' })
    expect(plain.body.checks.llm).toBeUndefined()
    expect(deps.checkLlm).not.toHaveBeenCalled()

    const deep = await request(app).get('/api/health?deep=1')
    expect(deep.status).toBe(200)
    expect(deep.body.checks.llm).toBe('ok')
    expect(deps.checkLlm).toHaveBeenCalledTimes(1)
  })

  it('checkDb 同步抛错不会让请求挂起，按 503 返回', async () => {
    const { app } = buildApp({
      checkDb: vi.fn(() => {
        throw new Error('pool not initialised')
      }) as unknown as HealthDeps['checkDb']
    })
    const res = await request(app).get('/api/health/ready')
    expect(res.status).toBe(503)
    expect(res.body.checks.db).toBe('fail')
  })

  it('checkReadiness 并行执行且 checkDb resolve false 视为失败', async () => {
    const result = await checkReadiness({
      checkDb: async () => false,
      isRabbitConnected: () => true,
      checkLlm: async () => true
    })
    expect(result).toEqual({ ready: false, checks: { db: 'fail', rabbitmq: 'ok' } })
  })
})
