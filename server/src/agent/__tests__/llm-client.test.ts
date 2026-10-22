import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LlmClient } from '../llm-client'
import { resetConfigForTests } from '../../config'

describe('LlmClient', () => {
  beforeEach(() => {
    // LlmClient 从 getConfig().llm 读取配置：先备齐必填项，再重置单例让本用例的 env 生效
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/test'
    process.env.RABBITMQ_URL = 'amqp://localhost:5672'
    process.env.LLM_API_KEY = 'test-key'
    process.env.LLM_BASE_URL = 'https://api.example.com'
    process.env.LLM_MODEL = 'test-model'
    process.env.LLM_PROVIDER = 'openai'
    resetConfigForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.LLM_BASE_URL
    delete process.env.LLM_MAX_RETRIES
    process.env.LLM_PROVIDER = 'openai'
    resetConfigForTests()
  })

  it('should construct with default values from config', () => {
    const client = new LlmClient()
    expect(client).toBeInstanceOf(LlmClient)
    expect(client.modelName).toBe('test-model')
  })

  it('overrides 优先于 config，未覆盖字段沿用 config', () => {
    const client = new LlmClient({ model: 'judge-model' })
    expect(client.modelName).toBe('judge-model')
  })

  it('anthropic 未配置 LLM_BASE_URL 时请求发往 Anthropic 默认地址（与 config 一致）', async () => {
    delete process.env.LLM_BASE_URL
    process.env.LLM_PROVIDER = 'anthropic'
    process.env.LLM_MAX_RETRIES = '0'
    resetConfigForTests()
    const client = new LlmClient()

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))
    await expect(client.chat([{ role: 'user', content: 'hello' }])).rejects.toThrow()

    expect(String(fetchSpy.mock.calls[0][0])).toBe('https://api.anthropic.com/v1/messages')
  })

  it('should handle fetch errors during chat', async () => {
    const client = new LlmClient()

    // Mock fetch to simulate a network error
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))

    await expect(client.chat([{ role: 'user', content: 'hello' }])).rejects.toThrow('Network error')
  })

  it('should handle non-OK HTTP responses', async () => {
    const client = new LlmClient()

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })
    )

    await expect(client.chat([{ role: 'user', content: 'hello' }])).rejects.toThrow(/LLM API error/)
  })
})
