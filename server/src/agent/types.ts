interface ToolCallInMessage {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  name?: string
  toolCalls?: ToolCallInMessage[]
}

interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

interface ToolCallRequest {
  id: string
  name: string
  input: Record<string, unknown>
}

interface LlmResponse {
  content: string
  finishReason: 'stop' | 'tool_use' | 'error'
  toolCalls: ToolCallRequest[]
}

export type { LlmMessage, ToolDefinition, ToolCallRequest, LlmResponse, ToolCallInMessage }
