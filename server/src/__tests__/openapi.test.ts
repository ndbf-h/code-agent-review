import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { buildOpenApiDocument } from '../openapi'
import { createDocsRouter } from '../routes/docs'

// zod schema 转 JSON Schema 时会读取 MAX_CODE_CHARS，需要最小可用配置
process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/test'
process.env.RABBITMQ_URL = 'amqp://localhost:5672'
process.env.LLM_API_KEY = 'test-key'

interface OpenApiDocument {
  openapi: string
  info: { title: string; version: string }
  components: { securitySchemes: Record<string, unknown> }
  paths: Record<string, Record<string, unknown>>
}

const doc = buildOpenApiDocument() as unknown as OpenApiDocument

describe('buildOpenApiDocument（REQ-16）', () => {
  it('声明 OpenAPI 3.1 与基本信息', () => {
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info.title).toContain('Code Agent Review')
    expect(doc.info.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('包含 ApiKeyAuth 鉴权方案', () => {
    expect(doc.components.securitySchemes.ApiKeyAuth).toBeDefined()
  })

  it('覆盖全部已注册路由与请求方法', () => {
    const expected: Array<[string, string]> = [
      ['/api/tasks', 'post'],
      ['/api/tasks', 'get'],
      ['/api/tasks/{id}', 'get'],
      ['/api/tasks/{id}/cancel', 'post'],
      ['/api/tasks/{id}/stream', 'get'],
      ['/api/tasks/{id}/chat/stream', 'post'],
      ['/api/tasks/{id}/versions', 'post'],
      ['/api/tasks/{id}/guidelines', 'post'],
      ['/api/tasks/{id}/fix', 'post'],
      ['/api/tasks/{id}/report.md', 'get'],
      ['/api/tasks/{id}/report.sarif', 'get'],
      ['/api/tasks/fetch-url', 'post'],
      ['/api/metrics', 'get'],
      ['/api/metrics/reset', 'post'],
      ['/api/health', 'get'],
      ['/api/health/live', 'get'],
      ['/api/health/ready', 'get'],
      ['/api/openapi.json', 'get'],
      ['/api/docs', 'get']
    ]

    for (const [path, method] of expected) {
      expect(doc.paths[path], `缺少路径 ${path}`).toBeDefined()
      expect(doc.paths[path][method], `缺少 ${method.toUpperCase()} ${path}`).toBeDefined()
    }
  })

  it('请求体 schema 由 zod 转换而来，保留 code / language 字段', () => {
    const post = doc.paths['/api/tasks'].post as {
      requestBody: { content: Record<string, { schema: { properties?: Record<string, unknown> } }> }
    }
    const schema = post.requestBody.content['application/json'].schema
    expect(Object.keys(schema.properties ?? {})).toContain('code')
    expect(Object.keys(schema.properties ?? {})).toContain('language')
  })
})

describe('接口文档路由', () => {
  function buildApp() {
    const app = express()
    app.use('/api', createDocsRouter())
    return app
  }

  it('GET /api/openapi.json 返回文档', async () => {
    const res = await request(buildApp()).get('/api/openapi.json')
    expect(res.status).toBe(200)
    expect(res.body.openapi).toBe('3.1.0')
  })

  it('GET /api/docs 返回加载 Swagger UI 的 HTML', async () => {
    const res = await request(buildApp()).get('/api/docs')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.text).toContain('swagger-ui')
    expect(res.text).toContain('/api/openapi.json')
  })
})
