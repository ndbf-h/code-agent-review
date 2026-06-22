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
      for (const toolCall of response.toolCalls) {
        if (onStep) onStep('tool_call', toolCall.name, toolCall.input)

        memory.add({
          role: 'assistant',
          content: JSON.stringify({ toolCall: toolCall.name, input: toolCall.input })
        })

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
    content: 'You have reached the maximum number of steps. Please provide your final answer now based on the information gathered.'
  })

  const context = memory.getContext()
  const finalResponse = await llmClient.chat(context, [])
  memory.add({ role: 'assistant', content: finalResponse.content })
  return finalResponse.content
}

export { runReActLoop }
export type { StepCallback }
