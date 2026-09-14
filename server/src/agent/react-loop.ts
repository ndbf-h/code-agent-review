import { llmClient, type LlmClient } from './llm-client'
import { toolRegistry } from './tool-registry'
import { Memory } from './memory'
import type { ToolDefinition } from './types'
import { createLogger } from '../logger'

const logger = createLogger('react-loop')
const MAX_ROUNDS = 10
const MIN_ROUNDS = 2

/** ReAct 工具调用治理计数器：同一 reviewer 的重试共享同一份，跨重试累计 */
export interface ToolCallGuard {
  /** 相同「工具 + 参数」允许的调用次数，超过即熔断；<=0 关闭熔断 */
  repeatThreshold: number
  /** 单个 reviewer 允许的工具调用总次数；<=0 不限制 */
  maxToolCalls: number
  /** 已熔断的重复调用次数 */
  loopBreaks: number
  /** 累计工具调用次数 */
  toolCalls: number
}

/** 稳定序列化：对象键排序，保证「相同参数」判定不受键顺序影响 */
function stableStringify(value: unknown, depth = 0): string {
  if (depth > 6) return '"..."'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item, depth + 1)).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : 1
  )
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item, depth + 1)}`)
    .join(',')}}`
}

export type StepType = 'thought' | 'tool_call' | 'tool_result' | 'thinking_token'

export type StepCallback = (
  type: StepType,
  arg1: string,
  arg2?: Record<string, unknown> | string
) => void

interface PendingToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

/**
 * 运行 ReAct 推理循环
 * @param systemPrompt - 系统提示词
 * @param tools - 可用工具列表
 * @param memory - 对话记忆
 * @param onStep - 步骤回调（用于 SSE 推送）
 * @param options.stream - 是否使用流式输出（默认 true）
 */
export async function runReActLoop(
  systemPrompt: string,
  tools: ToolDefinition[],
  memory: Memory,
  onStep?: StepCallback,
  options: {
    stream?: boolean
    client?: LlmClient
    signal?: AbortSignal
    /** REQ-11 治理计数器；缺省表示不做熔断与上限控制 */
    guard?: ToolCallGuard
  } = {}
): Promise<string> {
  // 按角色路由的 LLM 客户端（缺省用全局单例，行为与路由开启前一致）
  const llm = options.client || llmClient
  const signal = options.signal
  const useStream = options.stream !== false
  const guard = options.guard
  const seenCalls = new Map<string, number>()
  let toolCallLimitReached = false
  memory.add({ role: 'system', content: systemPrompt })

  /** 工具调用数是否已达上限 */
  const toolBudgetReached = (): boolean =>
    !!guard && guard.maxToolCalls > 0 && guard.toolCalls >= guard.maxToolCalls

  /** 达到上限时统一提示，外层据此提前进入强制总结 */
  const noteToolLimit = (): void => {
    logger.warn('工具调用达到上限，提前进入强制总结', { toolCalls: guard?.toolCalls })
    if (onStep) {
      onStep('thought', '工具调用次数已达上限，改为基于已收集的信息直接给出最终结论（JSON 格式）。')
    }
  }

  /** 执行单个工具调用，含重复调用熔断与计数 */
  async function runToolCall(toolCall: PendingToolCall): Promise<void> {
    if (onStep) onStep('tool_call', toolCall.name, toolCall.input)

    // 相同工具 + 相同参数重复出现：超过阈值后不执行，改为让模型换策略
    const signature = `${toolCall.name}::${stableStringify(toolCall.input)}`
    const seen = seenCalls.get(signature) ?? 0
    if (guard && guard.repeatThreshold > 0 && seen >= guard.repeatThreshold) {
      guard.loopBreaks += 1
      const message = `工具 ${toolCall.name} 以相同参数重复调用，已熔断。请更换策略或直接给出最终结论（JSON 格式）。`
      logger.warn('重复工具调用被熔断', { tool: toolCall.name, repeats: seen })
      if (onStep) onStep('thought', message)
      memory.add({ role: 'tool', content: message, toolCallId: toolCall.id, name: toolCall.name })
      return
    }

    seenCalls.set(signature, seen + 1)
    if (guard) guard.toolCalls += 1

    try {
      const result = await toolRegistry.execute({
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input
      })
      if (onStep) onStep('tool_result', toolCall.name, result)

      memory.add({
        role: 'tool',
        content: result,
        toolCallId: toolCall.id,
        name: toolCall.name
      })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      logger.warn(`Tool ${toolCall.name} failed: ${errorMsg}`)

      // 工具失败恢复：将错误信息反馈给 LLM
      memory.add({
        role: 'tool',
        content: `Error: ${errorMsg}. Please try a different approach or skip this check.`,
        toolCallId: toolCall.id,
        name: toolCall.name
      })
    }
  }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (signal?.aborted) {
      throw new Error('任务已取消')
    }
    const context = memory.getContext()
    logger.debug(`Round ${round + 1}/${MAX_ROUNDS}`, { contextLen: context.length })

    if (useStream && tools.length > 0) {
      // ── 流式路径 ──
      let fullContent = ''
      const pendingToolCalls: PendingToolCall[] = []

      for await (const chunk of llm.chatStream(context, tools, { signal })) {
        switch (chunk.type) {
          case 'text':
            fullContent += chunk.content
            if (onStep) onStep('thinking_token', chunk.content)
            break
          case 'tool_use':
            pendingToolCalls.push({
              id: chunk.id,
              name: chunk.name,
              input: chunk.input
            })
            break
          case 'done':
            // 流结束
            break
        }
      }

      // 处理完成后的逻辑
      if (pendingToolCalls.length > 0) {
        // 有工具调用 — 记录 assistant 消息
        memory.add({
          role: 'assistant',
          content: fullContent,
          toolCalls: pendingToolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.input)
            }
          }))
        })

        // 执行工具并记录结果（受 REQ-11 治理约束）
        for (const toolCall of pendingToolCalls) {
          if (toolBudgetReached()) {
            toolCallLimitReached = true
            break
          }
          await runToolCall(toolCall)
        }
        if (toolCallLimitReached) {
          noteToolLimit()
          break
        }
        // 继续下一轮
        continue
      }

      // 没有工具调用 — 正常结束
      memory.add({ role: 'assistant', content: fullContent })
      if (onStep) onStep('thought', fullContent)

      // 检查是否最小轮数已达到
      if (round >= MIN_ROUNDS - 1) {
        return fullContent
      }
      // 否则继续，让 Agent 可以做更多分析
      continue
    } else {
      // ── 非流式路径（兼容旧逻辑）──
      const response = await llm.chatWithRetry(context, tools, { signal })

      if (response.finishReason === 'stop') {
        memory.add({ role: 'assistant', content: response.content })
        if (onStep) onStep('thought', response.content)

        if (round >= MIN_ROUNDS - 1) {
          return response.content
        }
        continue
      }

      if (response.finishReason === 'tool_use') {
        memory.add({
          role: 'assistant',
          content: response.content || '',
          toolCalls: response.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.input)
            }
          }))
        })

        for (const toolCall of response.toolCalls) {
          if (toolBudgetReached()) {
            toolCallLimitReached = true
            break
          }
          await runToolCall(toolCall)
        }
        if (toolCallLimitReached) {
          noteToolLimit()
          break
        }
      }
    }
  }

  // 达到最大轮数 — 强制总结
  logger.warn('Max rounds reached, forcing summary')
  memory.add({
    role: 'user',
    content: '已达最大调用次数。请基于已收集的所有信息，给出最终结论（JSON 格式）。'
  })

  const context = memory.getContext()
  const finalResponse = await llm.chatWithRetry(context, [], { signal })
  memory.add({ role: 'assistant', content: finalResponse.content })
  return finalResponse.content
}
