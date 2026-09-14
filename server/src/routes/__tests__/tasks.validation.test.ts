import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../../app'
import { loadConfig } from '../../config'
import { setTaskProducer } from '../tasks'
import * as queries from '../../db/queries'
import * as taskService from '../../services/taskService'
import * as knowledgeService from '../../services/knowledgeService'
import * as urlSafety from '../../utils/urlSafety'
import type { TaskProducer } from '../../queue/producer'

vi.mock('../../db/queries', () => ({
  listTasks: vi.fn(),
  countTasks: vi.fn(),
  getTask: vi.fn(),
  getTaskEventsAfter: vi.fn(),
  markTaskFailed: vi.fn(),
  getReportByTask: vi.fn(),
  getConversationMessages: vi.fn(),
  insertConversationMessage: vi.fn(),
  insertCodeVersion: vi.fn(),
  linkCodeVersionToReview: vi.fn(),
  aggregateTaskMetrics: vi.fn(),
  recentTaskFailures: vi.fn(),
  getReviewCacheStats: vi.fn(),
  cancelTask: vi.fn()
}))
vi.mock('../../services/taskService', () => ({
  createTask: vi.fn(),
  createAgentsForTask: vi.fn(),
  getTaskDetail: vi.fn()
}))
vi.mock('../../services/eventService', () => ({
  appendTaskEvent: vi.fn(async () => 1),
  subscribeTaskEvents: vi.fn(() => () => undefined)
}))
vi.mock('../../services/assistantService', () => ({ streamAssistantReply: vi.fn() }))
vi.mock('../../services/knowledgeService', () => ({ addGuidelineDocument: vi.fn() }))
vi.mock('../../tools/fix', () => ({ applyFixes: { execute: vi.fn() } }))
vi.mock('../../utils/urlSafety', () => ({ resolveAndCheckIp: vi.fn() }))
vi.mock('../../agent/llm-client', () => ({
  getTokenUsage: () => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
  getRequestCount: () => 0,
  resetTokenUsage: vi.fn()
}))
vi.mock('../../agent/orchestrator', () => ({
  getAgentLatency: () => ({}),
  resetAgentLatency: vi.fn()
}))

const TASK_ID = '6f1c1a4e-2a8b-4a58-9c1d-3f2e5b7a9d10'
const sampleTask = {
  id: TASK_ID,
  title: 't',
  codeSnippet: 'const a = 1',
  language: 'javascript',
  status: 'completed',
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T00:00:00.000Z'
}

let app: ReturnType<typeof createApp>
const publishTask = vi.fn(async () => undefined)

beforeAll(() => {
  // MAX_CODE_CHARS 调小便于测试超长代码；日志静音
  const config = loadConfig({
    LLM_API_KEY: 'sk-test',
    DATABASE_URL: 'postgres://u:p@db:5432/review',
    RABBITMQ_URL: 'amqp://u:p@mq:5672/',
    MAX_CODE_CHARS: '50',
    MAX_BODY_SIZE: '1mb',
    LOG_LEVEL: 'ERROR',
    LOG_FORMAT: 'json'
  })
  app = createApp({
    config,
    health: {
      checkDb: async () => true,
      isRabbitConnected: () => true,
      checkLlm: async () => true
    },
    mountMcp: false,
    rateLimits: {
      global: { maxRequests: 10_000, windowMs: 60_000 },
      review: { maxRequests: 10_000, windowMs: 60_000 }
    }
  })
  setTaskProducer({
    publishTask,
    sendToRetry: vi.fn(),
    sendToDead: vi.fn()
  } as unknown as TaskProducer)
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(taskService.createTask).mockResolvedValue(sampleTask as never)
  vi.mocked(taskService.createAgentsForTask).mockResolvedValue(undefined)
  vi.mocked(taskService.getTaskDetail).mockResolvedValue({
    task: sampleTask,
    agents: [],
    messages: [],
    report: null
  } as never)
  vi.mocked(queries.listTasks).mockResolvedValue([] as never)
  vi.mocked(queries.countTasks).mockResolvedValue(0 as never)
  vi.mocked(queries.getTask).mockResolvedValue(sampleTask as never)
  vi.mocked(queries.getReportByTask).mockResolvedValue(null as never)
  vi.mocked(queries.insertCodeVersion).mockResolvedValue(undefined as never)
  vi.mocked(knowledgeService.addGuidelineDocument).mockResolvedValue({
    id: 'g1',
    chunks: 1
  } as never)
})

function expectValidationError(
  res: request.Response,
  location: 'body' | 'query' | 'params',
  field: string
) {
  expect(res.status).toBe(400)
  expect(res.body.code).toBe('VALIDATION_ERROR')
  expect(res.body.details).toEqual(
    expect.arrayContaining([expect.objectContaining({ location, field })])
  )
}

describe('POST /api/tasks', () => {
  it('缺少 language 返回 400 与字段级 details', async () => {
    const res = await request(app).post('/api/tasks').send({ code: 'x' })
    expectValidationError(res, 'body', 'language')
    expect(taskService.createTask).not.toHaveBeenCalled()
  })

  it('code 超过 MAX_CODE_CHARS 返回 400', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ code: 'x'.repeat(51), language: 'javascript' })
    expectValidationError(res, 'body', 'code')
  })

  it('reviewConfig 非法（空维度 / 未知字段）返回 400', async () => {
    const empty = await request(app)
      .post('/api/tasks')
      .send({ code: 'x', language: 'js', reviewConfig: { dimensions: [] } })
    expectValidationError(empty, 'body', 'reviewConfig.dimensions')

    const unknown = await request(app)
      .post('/api/tasks')
      .send({ code: 'x', language: 'js', reviewConfig: { foo: 1 } })
    expect(unknown.status).toBe(400)
  })

  it('合法输入创建任务并入队，返回 201', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ code: 'const a = 1', language: 'javascript', title: '  demo  ' })
    expect(res.status).toBe(201)
    expect(taskService.createTask).toHaveBeenCalledWith(
      'const a = 1',
      'javascript',
      'demo',
      undefined
    )
    expect(publishTask).toHaveBeenCalledWith(TASK_ID)
  })
})

describe('GET /api/tasks', () => {
  it('limit 非数字或 status 非枚举返回 400', async () => {
    expectValidationError(await request(app).get('/api/tasks?limit=abc'), 'query', 'limit')
    expectValidationError(await request(app).get('/api/tasks?status=bogus'), 'query', 'status')
    expectValidationError(await request(app).get('/api/tasks?limit=500'), 'query', 'limit')
  })

  it('缺省参数使用默认值 limit=20 offset=0', async () => {
    const res = await request(app).get('/api/tasks')
    expect(res.status).toBe(200)
    expect(queries.listTasks).toHaveBeenCalledWith(20, 0, undefined)
    expect(res.body).toMatchObject({ limit: 20, offset: 0, total: 0 })
  })

  it('合法参数按类型转换后传给查询层', async () => {
    const res = await request(app).get('/api/tasks?limit=5&offset=10&status=completed')
    expect(res.status).toBe(200)
    expect(queries.listTasks).toHaveBeenCalledWith(5, 10, 'completed')
    expect(queries.countTasks).toHaveBeenCalledWith('completed')
  })
})

describe('/:id 路径参数', () => {
  it('非 UUID 的 id 在各接口一律返回 400', async () => {
    expectValidationError(await request(app).get('/api/tasks/not-a-uuid'), 'params', 'id')
    expectValidationError(await request(app).post('/api/tasks/123/cancel'), 'params', 'id')
    expectValidationError(await request(app).post('/api/tasks/123/fix').send({}), 'params', 'id')
    expectValidationError(
      await request(app).post('/api/tasks/123/chat/stream').send({ message: 'hi' }),
      'params',
      'id'
    )
    expect(queries.getTask).not.toHaveBeenCalled()
    expect(taskService.getTaskDetail).not.toHaveBeenCalled()
  })

  it('合法 UUID 放行到处理器', async () => {
    const res = await request(app).get(`/api/tasks/${TASK_ID}`)
    expect(res.status).toBe(200)
    expect(taskService.getTaskDetail).toHaveBeenCalledWith(TASK_ID)
  })

  it('POST /:id/cancel 合法 UUID 放行并返回取消结果', async () => {
    vi.mocked(queries.cancelTask).mockResolvedValue(true as never)
    const res = await request(app).post(`/api/tasks/${TASK_ID}/cancel`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: TASK_ID, status: 'cancelled' })
    expect(queries.cancelTask).toHaveBeenCalledWith(TASK_ID)
  })
})

describe('GET /api/tasks/:id/stream', () => {
  it('非 UUID 返回 400 且不建立 SSE 连接', async () => {
    const res = await request(app).get('/api/tasks/not-a-uuid/stream')
    expectValidationError(res, 'params', 'id')
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(taskService.getTaskDetail).not.toHaveBeenCalled()
  })

  it('合法 UUID 建立 SSE 连接，已完成任务回放终态后关闭', async () => {
    vi.mocked(queries.getTaskEventsAfter).mockResolvedValue([] as never)
    const res = await request(app).get(`/api/tasks/${TASK_ID}/stream`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/event-stream/)
    expect(res.text).toContain('event: task_state')
    expect(res.text).toContain('event: task_completed')
    expect(taskService.getTaskDetail).toHaveBeenCalledWith(TASK_ID)
  })
})

describe('POST /api/tasks/:id/chat/stream', () => {
  it('message 为空白返回 400', async () => {
    const res = await request(app)
      .post(`/api/tasks/${TASK_ID}/chat/stream`)
      .send({ message: '   ' })
    expectValidationError(res, 'body', 'message')
  })

  it('合法 message 放行（无报告时 404）', async () => {
    const res = await request(app)
      .post(`/api/tasks/${TASK_ID}/chat/stream`)
      .send({ message: 'why' })
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('TASK_NOT_FOUND')
  })
})

describe('POST /api/tasks/:id/versions', () => {
  it('缺少 code 返回 400', async () => {
    const res = await request(app).post(`/api/tasks/${TASK_ID}/versions`).send({ language: 'js' })
    expectValidationError(res, 'body', 'code')
  })

  it('合法输入落库并返回 201', async () => {
    const res = await request(app)
      .post(`/api/tasks/${TASK_ID}/versions`)
      .send({ code: 'const b = 2', language: 'javascript' })
    expect(res.status).toBe(201)
    expect(queries.insertCodeVersion).toHaveBeenCalledTimes(1)
    expect(res.body.version).toMatchObject({ taskId: TASK_ID, source: 'assistant', summary: '' })
  })
})

describe('POST /api/tasks/:id/guidelines', () => {
  it('缺少 fileName 返回 400', async () => {
    const res = await request(app)
      .post(`/api/tasks/${TASK_ID}/guidelines`)
      .send({ content: 'rule' })
    expectValidationError(res, 'body', 'fileName')
  })

  it('合法输入返回 201', async () => {
    const res = await request(app)
      .post(`/api/tasks/${TASK_ID}/guidelines`)
      .send({ fileName: 'STYLE.md', content: 'always lint' })
    expect(res.status).toBe(201)
    expect(knowledgeService.addGuidelineDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'STYLE.md',
        content: 'always lint',
        language: '',
        dimension: ''
      })
    )
  })
})

describe('POST /api/tasks/:id/fix 错误响应统一带 code', () => {
  it('language 超长返回 400', async () => {
    const res = await request(app)
      .post(`/api/tasks/${TASK_ID}/fix`)
      .send({ language: 'x'.repeat(41) })
    expectValidationError(res, 'body', 'language')
  })

  it('任务不存在返回 404 TASK_NOT_FOUND', async () => {
    vi.mocked(queries.getTask).mockResolvedValue(null as never)
    const res = await request(app).post(`/api/tasks/${TASK_ID}/fix`).send({})
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('TASK_NOT_FOUND')
  })

  it('报告未生成返回 400 REPORT_NOT_READY', async () => {
    const res = await request(app).post(`/api/tasks/${TASK_ID}/fix`).send({})
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('REPORT_NOT_READY')
  })
})

describe('POST /api/tasks/fetch-url', () => {
  it('非 http/https 或格式错误的 url 返回 400', async () => {
    expectValidationError(
      await request(app).post('/api/tasks/fetch-url').send({ url: 'ftp://example.com/a.js' }),
      'body',
      'url'
    )
    expectValidationError(
      await request(app).post('/api/tasks/fetch-url').send({ url: 'not a url' }),
      'body',
      'url'
    )
    expect(urlSafety.resolveAndCheckIp).not.toHaveBeenCalled()
  })

  it('合法 url 放行到 SSRF 校验，被拦截时返回 400 URL_BLOCKED', async () => {
    vi.mocked(urlSafety.resolveAndCheckIp).mockRejectedValue(new Error('目标地址为内网 IP'))
    const res = await request(app)
      .post('/api/tasks/fetch-url')
      .send({ url: 'http://internal.example/a.js' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: '目标地址为内网 IP', code: 'URL_BLOCKED' })
  })
})
