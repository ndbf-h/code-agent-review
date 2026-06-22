import type { LlmMessage, ToolDefinition, LlmResponse, ToolCallRequest } from './types'

const LLM_API_KEY = process.env.LLM_API_KEY || ''
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.anthropic.com'
const LLM_MODEL = process.env.LLM_MODEL || 'claude-sonnet-4-6'

class LlmClient {
  private apiKey: string
  private baseUrl: string
  private model: string

  constructor() {
    this.apiKey = LLM_API_KEY
    this.baseUrl = LLM_BASE_URL
    this.model = LLM_MODEL
  }

  async chat(messages: LlmMessage[], tools?: ToolDefinition[]): Promise<LlmResponse> {
    const anthropicTools = tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object',
        properties: t.parameters,
        required: Object.keys(t.parameters)
      }
    }))

    const systemMessage = messages.find(m => m.role === 'system')
    const nonSystemMessages = messages.filter(m => m.role !== 'system')

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 4096,
      messages: nonSystemMessages.map(m => ({
        role: m.role,
        content: m.content
      }))
    }

    if (systemMessage) {
      body.system = systemMessage.content
    }

    if (anthropicTools && anthropicTools.length > 0) {
      body.tools = anthropicTools
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`LLM API error: ${response.status} ${errorText}`)
    }

    const data = await response.json() as Record<string, unknown>
    const content = data.content as Array<{
      type: string
      text?: string
      name?: string
      id?: string
      input?: Record<string, unknown>
    }>

    const textBlock = content.find(c => c.type === 'text')
    const toolBlocks = content.filter(c => c.type === 'tool_use')

    const toolCalls: ToolCallRequest[] = toolBlocks.map(t => ({
      id: (t.id as string) || '',
      name: (t.name as string) || '',
      input: (t.input as Record<string, unknown>) || {}
    }))

    return {
      content: textBlock?.text || '',
      finishReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
      toolCalls
    }
  }
}

const llmClient = new LlmClient()

export { LlmClient, llmClient }
