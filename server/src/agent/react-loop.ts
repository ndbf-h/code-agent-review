import { llmClient } from './llm-client'
import { toolRegistry } from './tool-registry'
import { Memory } from './memory'
import type { ToolDefinition } from './types'

const MAX_ROUNDS = 5

type StepType = 'thought' | 'tool_call' | 'tool_result'

type StepCallback = (
  type: StepType,
  arg1: string,
  arg2?: Record<string, unknown> | string
) => void

async function runReActLoop(
  systemPrompt: string,
  tools: ToolDefinition[],
  memory: Memory,
  onStep?: StepCallback
): Promise<string> {
  memory.add({ role: 'system', content: systemPrompt })

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const context = memory.getContext()
    const response = await llmClient.chat(context, tools)

    if (response.finishReason === 'stop') {
      memory.add({ role: 'assistant', content: response.content })
      if (onStep) onStep('thought', response.content)
      return response.content
    }

    if (response.finishReason === 'tool_use') {
      // 先记录 assistant 消息（含 tool_calls）
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
        if (onStep) onStep('tool_call', toolCall.name, toolCall.input)

        try {
          const result = await toolRegistry.execute(toolCall)
          if (onStep) onStep('tool_result', toolCall.name, result)

          memory.add({
            role: 'tool',
            content: result,
            toolCallId: toolCall.id,
            name: toolCall.name
          })
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          memory.add({
            role: 'tool',
            content: `Error: ${errorMsg}`,
            toolCallId: toolCall.id,
            name: toolCall.name
          })
        }
      }
    }
  }

  // 达到最大轮数
  memory.add({
    role: 'user',
    content: '已达最大调用次数，请基于已收集的信息给出最终结论。'
  })

  const context = memory.getContext()
  const finalResponse = await llmClient.chat(context, [])
  memory.add({ role: 'assistant', content: finalResponse.content })
  return finalResponse.content
}

export { runReActLoop }
export type { StepCallback }
