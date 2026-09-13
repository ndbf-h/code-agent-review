import type {
  LlmMessage,
  ToolDefinition,
  LlmResponse,
  ToolCallRequest,
  StreamChunk,
  LlmConfig,
  ChatOptions
} from './types'
import { createLogger } from '../logger'
import { LlmError } from '../errors'
import { createSemaphore } from '../utils/semaphore'
import { recordLlmUsage } from '../observability/tracing'

const logger = createLogger('llm-client')

// ── LLM 并发信号量 ──
// 每个任务约 5 路 LLM 调用（1 编排 + 4 reviewer 并行），worker prefetch 数 × 5
// 就是同时在飞的请求上限；超过配额会造成大量 429/排队，这里在进程内统一限流
const llmGate = createSemaphore(parseInt(process.env.LLM_MAX_CONCURRENCY || '12', 10))

// ── 可观测性：Token 使用量追踪 ──

let promptTokens = 0
let completionTokens = 0
let totalRequests = 0

/** 生成简短请求 ID，用于链路追踪 */
function generateRequestId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

/** 获取累计 Token 使用量 */
export function getTokenUsage() {
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens
  }
}

/** 重置 Token 使用量计数器 */
export function resetTokenUsage() {
  promptTokens = 0
  completionTokens = 0
}

/** 获取当前会话请求次数 */
export function getRequestCount() {
  return totalRequests
}

// ── 环境配置 ──

/** 从环境变量加载 LLM 配置 */
function loadConfig(): LlmConfig {
  return {
    apiKey: process.env.LLM_API_KEY || '',
    baseUrl: process.env.LLM_BASE_URL || 'https://api.deepseek.com',
    model: process.env.LLM_MODEL || 'deepseek-chat',
    provider: process.env.LLM_PROVIDER || 'openai'
  }
}

/** 获取最大重试次数 */
function loadMaxRetries(): number {
  return parseInt(process.env.LLM_MAX_RETRIES || '3', 10)
}

/** 是否为可重试的 HTTP 状态码 */
function isRetryableStatus(status: number): boolean {
  // 4xx 客户端错误不重试（429 限流除外）
  if (status >= 400 && status < 500 && status !== 429) return false
  return true
}

/** 延时工具函数 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 从 LLM 返回文本中提取 JSON
 * 处理可能的 markdown 代码块包裹
 */
function extractJson(text: string): string {
  // 尝试匹配 ```json ... ``` 代码块
  const codeBlock = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (codeBlock) {
    return codeBlock[1].trim()
  }
  // 尝试匹配以 { 或 [ 开头的最长片段
  const firstBrace = text.indexOf('{')
  const firstBracket = text.indexOf('[')
  let start = -1
  if (firstBrace === -1) start = firstBracket
  else if (firstBracket === -1) start = firstBrace
  else start = Math.min(firstBrace, firstBracket)
  if (start === -1) return text.trim()
  return text.slice(start).trim()
}

// ── 客户端 ──

class LlmClient {
  private config: LlmConfig
  private maxRetries: number

  /**
   * overrides 可覆盖任意配置项（如评测 judge、按角色路由使用不同模型）；
   * 未覆盖的字段仍从环境变量读取。
   */
  constructor(overrides?: Partial<LlmConfig>) {
    this.config = { ...loadConfig(), ...overrides }
    this.maxRetries = loadMaxRetries()
  }

  // ═══════════════════════════════════════════════════
  // 公开 API
  // ═══════════════════════════════════════════════════

  /**
   * 非流式对话（向后兼容）
   * @param messages 消息列表
   * @param tools 可选的工具定义
   * @param options 可选的调用选项
   */
  get modelName(): string {
    return this.config.model
  }

  async chat(
    messages: LlmMessage[],
    tools?: ToolDefinition[],
    options?: ChatOptions
  ): Promise<LlmResponse> {
    await llmGate.acquire()
    try {
      if (this.config.provider === 'anthropic') {
        return await this.chatAnthropic(messages, tools, options)
      }
      return await this.chatOpenAI(messages, tools, options)
    } finally {
      llmGate.release()
    }
  }

  /**
   * 流式对话，返回 AsyncGenerator<StreamChunk>
   * 解析 OpenAI 兼容的 SSE (Server-Sent Events) 格式
   * 信号量在整个流式生命周期内持有（迭代完成或提前 return 时释放）
   */
  async *chatStream(
    messages: LlmMessage[],
    tools?: ToolDefinition[],
    options?: ChatOptions
  ): AsyncGenerator<StreamChunk> {
    await llmGate.acquire()
    try {
      if (this.config.provider === 'anthropic') {
        yield* this.chatAnthropicStream(messages, tools, options)
        return
      }
      yield* this.chatOpenAIStream(messages, tools, options)
    } finally {
      llmGate.release()
    }
  }

  /**
   * 带自动重试的对话
   * 指数退避: 1s, 2s, 4s，最多重试 maxRetries 次
   * 4xx 客户端错误（429 除外）不重试
   */
  async chatWithRetry(
    messages: LlmMessage[],
    tools?: ToolDefinition[],
    options?: ChatOptions
  ): Promise<LlmResponse> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = Math.pow(2, attempt - 1) * 1000 // 1s, 2s, 4s, ...
          logger.info(`LLM 重试 第 ${attempt}/${this.maxRetries} 次`, {
            delay,
            nextAttempt: attempt + 1
          })
          await sleep(delay)
        }

        return await this.chat(messages, tools, options)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // 取消中断：直接上抛，绝不重试
        if (options?.signal?.aborted) {
          throw lastError
        }

        // 检查是否为不可重试的 4xx 错误
        if (lastError instanceof LlmError && lastError.details) {
          const details = lastError.details as { status?: number }
          if (details.status && !isRetryableStatus(details.status)) {
            logger.warn('收到不可重试的客户端错误，停止重试', {
              status: details.status,
              attempt
            })
            throw lastError
          }
        }

        // 非 LlmError（如网络错误）也可以重试
        if (attempt >= this.maxRetries) {
          logger.error('LLM 调用失败，已达最大重试次数', {
            maxRetries: this.maxRetries,
            error: lastError.message
          })
          throw new LlmError(
            `LLM 调用失败，已重试 ${this.maxRetries} 次: ${lastError.message}`,
            { originalError: lastError.message }
          )
        }

        logger.warn(`LLM 调用失败，准备重试 ${attempt + 1}/${this.maxRetries}`, {
          error: lastError.message
        })
      }
    }

    // 不可达，但 TypeScript 需要
    throw new LlmError('LLM 调用失败，已达最大重试次数')
  }

  /**
   * 结构化输出：要求 LLM 返回 JSON，自动解析并验证
   * 解析失败时自动重试
   *
   * @param messages 消息列表
   * @param schema 可选的 JSON Schema 描述（用于 prompt 指引）
   * @param maxRetries 可选的最大重试次数（默认使用实例配置）
   * @returns 解析后的强类型对象
   */
  async chatStructured<T>(
    messages: LlmMessage[],
    schema?: Record<string, unknown>,
    maxRetries?: number,
    signal?: AbortSignal
  ): Promise<T> {
    const retries = maxRetries ?? this.maxRetries
    const augmentedMessages = [...messages]

    // 追加 JSON 格式指令
    if (schema) {
      augmentedMessages.push({
        role: 'user',
        content:
          `请严格按照以下 JSON Schema 返回数据，只返回纯 JSON，不要包含任何解释、markdown 代码块标记或其他文字：\n` +
          `\`\`\`\n${JSON.stringify(schema, null, 2)}\n\`\`\``
      })
    } else {
      augmentedMessages.push({
        role: 'user',
        content: '请以纯 JSON 格式返回你的回答，不要包含 markdown 代码块标记或其他文字。只返回有效的 JSON。'
      })
    }

    let lastError: Error | null = null
    let lastResponseText = ''

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = Math.pow(2, attempt - 1) * 1000
          logger.info(`结构化输出重试 ${attempt}/${retries}`, { delay })
          await sleep(delay)
        }

        const response = await this.chat(augmentedMessages, undefined, { jsonMode: true, signal })
        const responseText = response.content
        lastResponseText = responseText
        const jsonText = extractJson(responseText)

        if (!jsonText) {
          throw new Error('响应内容为空，无法提取 JSON')
        }

        const parsed = JSON.parse(jsonText) as T
        logger.info('结构化输出解析成功', { attempt })
        return parsed
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        if (signal?.aborted) {
          throw lastError
        }

        if (attempt >= retries) {
          break
        }

        logger.warn(`结构化输出解析失败，重试 ${attempt + 1}/${retries}`, {
          error: lastError.message
        })

        // 追加修正提示，包含上次 LLM 返回的原始文本，帮助 LLM 理解问题
        const previousSnippet = lastResponseText
          ? `\n上次返回的内容（截取前500字符）：\n\`\`\`\n${lastResponseText.slice(0, 500)}${lastResponseText.length > 500 ? '\n...（已截断）' : ''}\n\`\`\``
          : ''
        augmentedMessages.push({
          role: 'user',
          content: `上次返回的内容无法解析为有效的 JSON。错误信息: ${lastError.message}。${previousSnippet}请确保只返回纯 JSON 格式，不要包含任何额外的文字或 markdown 标记。`
        })
      }
    }

    throw new LlmError(
      `结构化输出解析失败，已重试 ${retries} 次: ${lastError?.message}`,
      { lastError: lastError?.message }
    )
  }

  /**
   * 健康检查：发送最小 ping 请求验证 LLM 连通性
   * @returns true 表示连通正常
   */
  async healthCheck(): Promise<boolean> {
    try {
      logger.debug('LLM 健康检查开始')
      const response = await this.chat(
        [{ role: 'user', content: 'ping' }],
        undefined,
        { maxTokens: 1, temperature: 0 }
      )
      const ok = !!response.content || response.finishReason !== 'error'
      logger.info('LLM 健康检查完成', { ok })
      return ok
    } catch (error) {
      logger.warn('LLM 健康检查失败', {
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  // ═══════════════════════════════════════════════════
  // 共享映射辅助方法
  // ═══════════════════════════════════════════════════

  /** 将 ToolDefinition 数组映射为 OpenAI 兼容的 tools 格式 */
  private mapToolsToOpenAI(tools?: ToolDefinition[]) {
    return tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object' as const,
          properties: t.parameters,
          required: Object.keys(t.parameters)
        }
      }
    }))
  }

  /** 将 LlmMessage 数组映射为 OpenAI 兼容的 messages 格式 */
  private mapMessagesToOpenAI(messages: LlmMessage[]) {
    return messages.map(m => {
      const msg: Record<string, unknown> = {
        role: m.role,
        content: m.content || ''
      }
      if (m.toolCallId) msg.tool_call_id = m.toolCallId
      if (m.name) msg.name = m.name
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls
      }
      return msg
    })
  }

  // ═══════════════════════════════════════════════════
  // OpenAI / DeepSeek 兼容格式
  // ═══════════════════════════════════════════════════

  private async chatOpenAI(
    messages: LlmMessage[],
    tools?: ToolDefinition[],
    options?: ChatOptions
  ): Promise<LlmResponse> {
    const requestId = generateRequestId()
    totalRequests++
    logger.debug('LLM 请求开始', {
      requestId,
      model: this.config.model,
      provider: this.config.provider,
      messageCount: messages.length
    })

    const openaiTools = this.mapToolsToOpenAI(tools)

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: options?.maxTokens ?? 4096,
      messages: this.mapMessagesToOpenAI(messages)
    }

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature
    }
    if (openaiTools && openaiTools.length > 0) {
      body.tools = openaiTools
    }
    if (options?.jsonMode) {
      body.response_format = { type: 'json_object' }
    }

    let response: Response
    try {
      response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify(body),
        signal: options?.signal
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error('LLM 网络请求失败', { error: msg })
      // 网络错误直接上抛，保留原始错误类型以供调用方判断
      throw error
    }

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('LLM 请求失败', { status: response.status, body: errorText })
      throw new LlmError(
        `LLM API error: ${response.status} ${errorText}`,
        { status: response.status, body: errorText }
      )
    }

    const data = (await response.json()) as Record<string, unknown>
    const choices = data.choices as Array<{
      message: {
        content?: string
        tool_calls?: Array<{
          id: string
          function: { name: string; arguments: string }
        }>
      }
      finish_reason: string
    }>

    // 解析 token 使用量
    const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
    if (usage) {
      promptTokens += usage.prompt_tokens || 0
      completionTokens += usage.completion_tokens || 0
      recordLlmUsage({ model: this.config.model, promptTokens: usage.prompt_tokens || 0, completionTokens: usage.completion_tokens || 0 })
    }

    const choice = choices[0]
    if (!choice) {
      logger.warn('LLM 返回空 choices')
      return { content: '', finishReason: 'error', toolCalls: [] }
    }

    const msg = choice.message
    const hasToolCalls = !!(msg.tool_calls && msg.tool_calls.length > 0)

    const toolCalls: ToolCallRequest[] = hasToolCalls
      ? msg.tool_calls!.map(tc => {
          let input: Record<string, unknown> = {}
          try {
            input = JSON.parse(tc.function.arguments)
          } catch {
            /* 参数解析失败时保持空对象 */
          }
          return {
            id: tc.id,
            name: tc.function.name,
            input
          }
        })
      : []

    const contentLength = msg.content?.length || 0
    const finishReason = hasToolCalls ? 'tool_use' : 'stop'
    logger.info('LLM 响应成功', {
      requestId,
      finishReason,
      contentLength,
      promptTokens: usage?.prompt_tokens || 0,
      completionTokens: usage?.completion_tokens || 0
    })

    return {
      content: msg.content || '',
      finishReason,
      toolCalls
    }
  }

  /**
   * OpenAI 兼容的 SSE 流式请求
   * 解析 data: {json}\n\n 格式的事件流
   */
  private async *chatOpenAIStream(
    messages: LlmMessage[],
    tools?: ToolDefinition[],
    options?: ChatOptions
  ): AsyncGenerator<StreamChunk> {
    const requestId = generateRequestId()
    totalRequests++
    logger.debug('LLM 流式请求开始', {
      requestId,
      model: this.config.model,
      provider: this.config.provider,
      messageCount: messages.length
    })

    const openaiTools = this.mapToolsToOpenAI(tools)

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: options?.maxTokens ?? 4096,
      stream: true,
      messages: this.mapMessagesToOpenAI(messages)
    }

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature
    }
    if (openaiTools && openaiTools.length > 0) {
      body.tools = openaiTools
    }

    let response: Response
    try {
      response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify(body),
        signal: options?.signal
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error('LLM 流式网络请求失败', { error: msg })
      throw error
    }

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('LLM 流式请求失败', { status: response.status, body: errorText })
      throw new LlmError(
        `LLM stream error: ${response.status} ${errorText}`,
        { status: response.status, body: errorText }
      )
    }

    const decoder = new TextDecoder()
    let buffer = ''

    // 累积工具调用参数（流式传输中参数分片到达）
    const toolCallsAcc = new Map<
      number,
      { id: string; name: string; args: string }
    >()

    let doneYielded = false
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

    try {
      reader = response.body?.getReader()
      if (!reader) {
        throw new LlmError('无法获取流式响应读取器')
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        // 最后一行可能不完整，保留到下次处理
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue

          const dataStr = trimmed.slice(6)
          if (dataStr === '[DONE]') {
            // 流结束前，提交所有已累积的 tool calls
            for (const tc of toolCallsAcc.values()) {
              if (tc.name) {
                try {
                  yield {
                    type: 'tool_use',
                    id: tc.id,
                    name: tc.name,
                    input: JSON.parse(tc.args || '{}')
                  }
                } catch {
                  yield {
                    type: 'tool_use',
                    id: tc.id,
                    name: tc.name,
                    input: {}
                  }
                }
              }
            }
            yield { type: 'done' }
            doneYielded = true
            return
          }

          try {
            const parsed = JSON.parse(dataStr) as Record<string, unknown>
            const choices = parsed.choices as Array<{
              index?: number
              delta?: {
                content?: string
                tool_calls?: Array<{
                  index?: number
                  id?: string
                  type?: string
                  function?: { name?: string; arguments?: string }
                }>
              }
              finish_reason?: string | null
            }> | undefined
            const choice = choices?.[0]
            if (!choice) continue

            const delta = choice.delta

            // 文本内容
            if (delta?.content) {
              yield { type: 'text', content: delta.content }
            }

            // 工具调用（流式分片累积）
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0
                if (!toolCallsAcc.has(idx)) {
                  toolCallsAcc.set(idx, { id: '', name: '', args: '' })
                }
                const acc = toolCallsAcc.get(idx)!
                if (tc.id) acc.id = tc.id
                if (tc.function?.name) acc.name = tc.function.name
                if (tc.function?.arguments) acc.args += tc.function.arguments
              }
            }

            // 从流式最后 chunk 提取 token 使用量（DeepSeek/OpenAI 在 finish_reason chunk 返回 usage）
            const streamUsage = parsed.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
            if (streamUsage) {
              promptTokens += streamUsage.prompt_tokens || 0
              completionTokens += streamUsage.completion_tokens || 0
              recordLlmUsage({ model: this.config.model, promptTokens: streamUsage.prompt_tokens || 0, completionTokens: streamUsage.completion_tokens || 0 })
              logger.debug('LLM 流式 token 用量', {
                requestId,
                promptTokens: streamUsage.prompt_tokens,
                completionTokens: streamUsage.completion_tokens
              })
            }

            // finish_reason 为 stop 且没有 tool_calls 时表示结束
            if (choice.finish_reason === 'stop' && !delta?.tool_calls && !doneYielded) {
              yield { type: 'done' }
              doneYielded = true
            }
          } catch {
            // 跳过无法解析的事件行
            continue
          }
        }
      }

      // 流读取完毕但未收到 [DONE]，发送结束信号
      if (!doneYielded) {
        logger.debug('LLM 流式传输结束（未收到 [DONE]）')
        yield { type: 'done' }
      }
    } finally {
      reader?.releaseLock()
    }
  }

  // ═══════════════════════════════════════════════════
  // Anthropic 格式（保留兼容）
  // ═══════════════════════════════════════════════════

  /**
   * Anthropic Messages API 流式请求
   * 解析 SSE 事件流（event: + data: 格式），转换为 StreamChunk
   *
   * Anthropic 流式事件类型:
   *   message_start      - 消息开始，含 usage.input_tokens
   *   content_block_start - 内容块开始，含 content_block 类型（text / tool_use）
   *   content_block_delta - 增量文本（text_delta）或 tool_use 部分 JSON（input_json_delta）
   *   content_block_stop  - 内容块结束
   *   message_delta       - 含 stop_reason 和 usage.output_tokens
   *   message_stop        - 流结束
   *
   * tool_use 的 input 通过 input_json_delta 增量传输，
   * 需要手动拼接完整 JSON 后 parse 为对象
   */
  private async *chatAnthropicStream(
    messages: LlmMessage[],
    tools?: ToolDefinition[],
    options?: ChatOptions
  ): AsyncGenerator<StreamChunk> {
    const requestId = generateRequestId()
    totalRequests++
    logger.debug('LLM 流式请求开始 (Anthropic)', {
      requestId,
      model: this.config.model,
      provider: this.config.provider,
      messageCount: messages.length
    })

    const anthropicTools = tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object' as const,
        properties: t.parameters,
        required: Object.keys(t.parameters)
      }
    }))

    const systemMessage = messages.find(m => m.role === 'system')
    const nonSystemMessages = messages.filter(m => m.role !== 'system')

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: options?.maxTokens ?? 4096,
      stream: true,
      messages: nonSystemMessages.map(m => ({ role: m.role, content: m.content }))
    }

    if (systemMessage) {
      body.system = systemMessage.content
    }
    if (options?.temperature !== undefined) {
      body.temperature = options.temperature
    }
    if (anthropicTools && anthropicTools.length > 0) {
      body.tools = anthropicTools
    }

    let response: Response
    try {
      response = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body),
        signal: options?.signal
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error('LLM 流式网络请求失败 (Anthropic)', { error: msg })
      throw error
    }

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('LLM 流式请求失败 (Anthropic)', {
        status: response.status,
        body: errorText
      })
      throw new LlmError(
        `LLM stream error: ${response.status} ${errorText}`,
        { status: response.status, body: errorText }
      )
    }

    const decoder = new TextDecoder()
    let buffer = ''

    // 累积 tool_use 数据（按 content block index 分组）
    // Anthropic 的 tool_use input 以增量 JSON（input_json_delta）传输
    const toolUsesAcc = new Map<
      number,
      { id: string; name: string; inputJson: string }
    >()

    let doneYielded = false
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    // Anthropic 流式把 input_tokens 拆在 message_start、output_tokens 拆在 message_delta，
    // 局部暂存后在 delta 处合并为一次 usage 记录，避免重复计数
    let anthropicInputTokens = 0

    try {
      reader = response.body?.getReader()
      if (!reader) {
        throw new LlmError('无法获取流式响应读取器')
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        // 归一化行尾符（Windows \r\n → Unix \n）
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

        // Anthropic SSE 事件以 \n\n 分隔
        while (true) {
          const eventEnd = buffer.indexOf('\n\n')
          if (eventEnd === -1) break

          const eventText = buffer.slice(0, eventEnd)
          buffer = buffer.slice(eventEnd + 2)

          // 解析 event: 和 data: 行
          let eventType = ''
          let dataStr = ''

          for (const line of eventText.split('\n')) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim()
            } else if (line.startsWith('data: ')) {
              dataStr = line.slice(6)
            }
          }

          if (!dataStr) continue

          try {
            const parsed = JSON.parse(dataStr) as Record<string, unknown>

            switch (eventType) {
              case 'content_block_start': {
                const contentBlock = parsed.content_block as Record<
                  string,
                  unknown
                > | undefined
                if (contentBlock?.type === 'tool_use') {
                  const index = (parsed.index as number) ?? 0
                  toolUsesAcc.set(index, {
                    id: (contentBlock.id as string) || '',
                    name: (contentBlock.name as string) || '',
                    inputJson: ''
                  })
                }
                break
              }

              case 'content_block_delta': {
                const delta = parsed.delta as Record<string, unknown> | undefined
                const index = (parsed.index as number) ?? 0

                if (delta?.type === 'text_delta') {
                  const text = (delta.text as string) || ''
                  yield { type: 'text', content: text }
                } else if (delta?.type === 'input_json_delta') {
                  const acc = toolUsesAcc.get(index)
                  if (acc) {
                    acc.inputJson += (delta.partial_json as string) || ''
                  }
                }
                break
              }

              case 'content_block_stop': {
                // 内容块结束 — 若为 tool_use 则提交累积完成的完整结果
                const index = (parsed.index as number) ?? 0
                const acc = toolUsesAcc.get(index)
                if (acc && acc.name) {
                  let parsedInput: Record<string, unknown> = {}
                  try {
                    parsedInput = JSON.parse(acc.inputJson || '{}')
                  } catch {
                    // 增量 JSON 拼接不完整时保持空对象
                    logger.warn('tool_use input JSON 解析失败', {
                      id: acc.id,
                      name: acc.name
                    })
                  }
                  yield {
                    type: 'tool_use',
                    id: acc.id,
                    name: acc.name,
                    input: parsedInput
                  }
                }
                break
              }

              case 'message_delta': {
                // 记录 stop_reason 和 output_tokens
                const delta = parsed.delta as Record<string, unknown> | undefined
                const usage = parsed.usage as
                  | { output_tokens?: number }
                  | undefined
                if (usage?.output_tokens) {
                  completionTokens += usage.output_tokens
                  recordLlmUsage({ model: this.config.model, promptTokens: anthropicInputTokens, completionTokens: usage.output_tokens })
                }
                logger.debug('Anthropic 流式 message_delta', {
                  requestId,
                  stopReason: delta?.stop_reason,
                  outputTokens: usage?.output_tokens
                })
                break
              }

              case 'message_start': {
                // 记录 input_tokens
                const message = parsed.message as Record<string, unknown> | undefined
                const usage = message?.usage as
                  | { input_tokens?: number }
                  | undefined
                if (usage?.input_tokens) {
                  promptTokens += usage.input_tokens
                  anthropicInputTokens = usage.input_tokens
                }
                break
              }

              case 'message_stop': {
                if (!doneYielded) {
                  yield { type: 'done' }
                  doneYielded = true
                }
                return
              }
            }
          } catch {
            // 跳过无法解析的事件
            continue
          }
        }
      }

      // 流读取完毕但未收到 message_stop，发送结束信号
      if (!doneYielded) {
        logger.debug('LLM 流式传输结束（未收到 message_stop）')
        yield { type: 'done' }
      }
    } finally {
      reader?.releaseLock()
    }
  }

  private async chatAnthropic(
    messages: LlmMessage[],
    tools?: ToolDefinition[],
    options?: ChatOptions
  ): Promise<LlmResponse> {
    const requestId = generateRequestId()
    totalRequests++
    logger.debug('LLM 请求开始 (Anthropic)', {
      requestId,
      model: this.config.model,
      provider: this.config.provider,
      messageCount: messages.length
    })

    const anthropicTools = tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object' as const,
        properties: t.parameters,
        required: Object.keys(t.parameters)
      }
    }))

    const systemMessage = messages.find(m => m.role === 'system')
    const nonSystemMessages = messages.filter(m => m.role !== 'system')

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: options?.maxTokens ?? 4096,
      messages: nonSystemMessages.map(m => ({ role: m.role, content: m.content }))
    }

    if (systemMessage) {
      body.system = systemMessage.content
    }
    if (options?.temperature !== undefined) {
      body.temperature = options.temperature
    }
    if (anthropicTools && anthropicTools.length > 0) {
      body.tools = anthropicTools
    }

    let response: Response
    try {
      response = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body),
        signal: options?.signal
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error('LLM 网络请求失败 (Anthropic)', { error: msg })
      throw error
    }

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('LLM 请求失败 (Anthropic)', {
        status: response.status,
        body: errorText
      })
      throw new LlmError(
        `LLM API error: ${response.status} ${errorText}`,
        { status: response.status, body: errorText }
      )
    }

    const data = (await response.json()) as Record<string, unknown>
    const content = data.content as Array<{
      type: string
      text?: string
      name?: string
      id?: string
      input?: Record<string, unknown>
    }>

    // 解析 Anthropic token 使用量（input_tokens / output_tokens）
    const usage = data.usage as { input_tokens?: number; output_tokens?: number } | undefined
    if (usage) {
      promptTokens += usage.input_tokens || 0
      completionTokens += usage.output_tokens || 0
      recordLlmUsage({ model: this.config.model, promptTokens: usage.input_tokens || 0, completionTokens: usage.output_tokens || 0 })
    }

    const textBlock = content.find(c => c.type === 'text')
    const toolBlocks = content.filter(c => c.type === 'tool_use')

    const toolCalls: ToolCallRequest[] = toolBlocks.map(t => ({
      id: (t.id as string) || '',
      name: (t.name as string) || '',
      input: (t.input as Record<string, unknown>) || {}
    }))

    const contentLength = textBlock?.text?.length || 0
    const finishReason = toolCalls.length > 0 ? 'tool_use' : 'stop'
    logger.info('LLM 响应成功 (Anthropic)', {
      requestId,
      finishReason,
      contentLength,
      inputTokens: usage?.input_tokens || 0,
      outputTokens: usage?.output_tokens || 0
    })

    return {
      content: textBlock?.text || '',
      finishReason,
      toolCalls
    }
  }
}

// ── 单例 ──

const llmClient = new LlmClient()

export { LlmClient, llmClient }
