// ── LLM 类型定义 ──
// 所有 LLM 相关类型的单一事实来源

/** 工具调用在消息体中的表示格式 */
interface ToolCallInMessage {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

/** LLM 消息（用于 chat completions API） */
interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  name?: string
  toolCalls?: ToolCallInMessage[]
}

/** 工具定义（用于向 LLM 注册工具） */
interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** 工具调用请求（LLM 返回的调用指令） */
interface ToolCallRequest {
  id: string
  name: string
  input: Record<string, unknown>
}

/** LLM 完整响应 */
interface LlmResponse {
  content: string
  finishReason: 'stop' | 'tool_use' | 'error'
  toolCalls: ToolCallRequest[]
}

/** 流式响应中的单个数据块 */
type StreamChunk =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'done' }

/** LLM 客户端配置 */
interface LlmConfig {
  apiKey: string
  baseUrl: string
  model: string
  provider: string
  maxRetries?: number
}

/** Chat 调用选项 */
interface ChatOptions {
  maxTokens?: number
  temperature?: number
  stream?: boolean
  jsonMode?: boolean
  /** 取消信号：中断在途 HTTP 请求（任务取消时由 consumer 传入） */
  signal?: AbortSignal
}

export type {
  LlmMessage,
  ToolDefinition,
  ToolCallRequest,
  LlmResponse,
  ToolCallInMessage,
  StreamChunk,
  LlmConfig,
  ChatOptions
}
