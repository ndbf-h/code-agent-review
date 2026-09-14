import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LlmClient } from '../llm-client'

describe('LlmClient', () => {
  beforeEach(() => {
    // Use real env or set defaults for construction
    process.env.LLM_API_KEY = 'test-key'
    process.env.LLM_BASE_URL = 'https://api.example.com'
    process.env.LLM_MODEL = 'test-model'
    process.env.LLM_PROVIDER = 'openai'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should construct with default values from env', () => {
    const client = new LlmClient()
    expect(client).toBeInstanceOf(LlmClient)
  })

  it('should handle empty API key gracefully', () => {
    process.env.LLM_API_KEY = ''
    const client = new LlmClient()
    expect(client).toBeInstanceOf(LlmClient)
  })

  it('should support anthropic provider', () => {
    process.env.LLM_PROVIDER = 'anthropic'
    const client = new LlmClient()
    expect(client).toBeInstanceOf(LlmClient)
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
