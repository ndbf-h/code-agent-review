import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { accessLogMiddleware } from '../accessLog'
import { configureLogger } from '../../logger'

function captureDestination() {
  const lines: string[] = []
  return {
    write(chunk: string) {
      lines.push(chunk)
    },
    records() {
      return lines
        .join('')
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as Record<string, unknown>)
    }
  }
}

function buildApp() {
  const app = express()
  app.use(accessLogMiddleware)
  app.get('/ok', (_req, res) => res.json({ ok: true }))
  app.get('/bad', (_req, res) => res.status(404).json({ error: 'nope' }))
  app.get('/boom', (_req, res) => res.status(500).json({ error: 'boom' }))
  app.get('/api/health/live', (_req, res) => res.json({ status: 'ok' }))
  app.get('/stream', (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write('event: ping\n\n')
    // 永不主动结束，等待客户端断开
  })
  return app
}

describe('访问日志中间件', () => {
  let sink: ReturnType<typeof captureDestination>

  beforeEach(() => {
    sink = captureDestination()
    configureLogger({ level: 'DEBUG', format: 'json', destination: sink })
  })

  afterAll(() => {
    configureLogger({ level: 'ERROR', format: 'json' })
  })

  it('正常响应记录一条 info，包含 method / path / status / durationMs', async () => {
    await request(buildApp()).get('/ok?secret=1')
    const records = sink.records().filter(r => r.msg === 'request')
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ level: 'info', method: 'GET', path: '/ok', status: 200 })
    expect(typeof records[0].durationMs).toBe('number')
    expect(records[0].aborted).toBeUndefined()
    expect(JSON.stringify(records[0])).not.toContain('secret')
  })

  it('4xx 记 warn，5xx 记 error，健康探针降为 debug', async () => {
    const app = buildApp()
    await request(app).get('/bad')
    await request(app).get('/boom')
    await request(app).get('/api/health/live')
    const levels = sink
      .records()
      .filter(r => r.msg === 'request')
      .map(r => [r.path, r.level])
    expect(levels).toEqual([
      ['/bad', 'warn'],
      ['/boom', 'error'],
      ['/api/health/live', 'debug']
    ])
  })

  it('客户端中断 SSE 长连接时仍记录一条日志并标注 aborted', async () => {
    const server = http.createServer(buildApp())
    await new Promise<void>(resolve => server.listen(0, resolve))
    const { port } = server.address() as AddressInfo

    await new Promise<void>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/stream' }, res => {
        res.once('data', () => {
          req.destroy()
          resolve()
        })
      })
      req.on('error', () => resolve())
      req.setTimeout(2000, () => reject(new Error('timeout')))
    })

    // 等待服务端触发 close 事件
    await new Promise(resolve => setTimeout(resolve, 100))
    await new Promise<void>(resolve => server.close(() => resolve()))

    const records = sink.records().filter(r => r.msg === 'request')
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ path: '/stream', aborted: true, level: 'warn' })
  })
})
