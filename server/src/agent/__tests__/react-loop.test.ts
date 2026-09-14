import { describe, expect, it, vi } from 'vitest'
import { runReActLoop, type ToolCallGuard } from '../react-loop'
import { toolRegistry } from '../tool-registry'
import { Memory } from '../memory'
import type { ToolDefinition } from '../types'

const tools = [
  { name: 'checkPattern', description: '检查代码模式', parameters: {} }
] as unknown as ToolDefinition[]

/** 造一个按轮次返回工具调用的假 LLM 客户端 */
function createFakeClient(respond: (round: number) => unknown[]) {
  let round = 0
  const summary = { calls: 0 }
  const client = {
    async *chatStream() {
      for (const chunk of respond(round++)) yield chunk
    },
    async chatWithRetry() {
      summary.calls += 1
      return { content: '{"issues":[],"score":80}', finishReason: 'stop', toolCalls: [] }
    }
  }
  return { client, summary }
}

describe('runReActLoop 工具治理（REQ-11）', () => {
  it('相同工具与参数重复调用超过阈值后熔断', async () => {
    const execute = vi.spyOn(toolRegistry, 'execute').mockResolvedValue('{"ok":true}')
    const guard: ToolCallGuard = {
      repeatThreshold: 2,
      maxToolCalls: 50,
      loopBreaks: 0,
      toolCalls: 0
    }
    const { client } = createFakeClient(() => [
      { type: 'tool_use', id: 'call-fixed', name: 'checkPattern', input: { pattern: 'sql' } },
      { type: 'done' }
    ])

    await runReActLoop('system', tools, new Memory(), undefined, {
      client: client as never,
      guard
    })

    // 前 2 次放行，之后每轮命中熔断不再真正执行工具
    expect(execute).toHaveBeenCalledTimes(2)
    expect(guard.toolCalls).toBe(2)
    expect(guard.loopBreaks).toBeGreaterThan(0)

    execute.mockRestore()
  })

  it('工具调用数达到上限后停止执行并进入强制总结', async () => {
    const execute = vi.spyOn(toolRegistry, 'execute').mockResolvedValue('{"ok":true}')
    const guard: ToolCallGuard = {
      repeatThreshold: 0,
      maxToolCalls: 3,
      loopBreaks: 0,
      toolCalls: 0
    }
    // 每轮参数不同，避免触发熔断逻辑，专门验证上限分支
    const { client, summary } = createFakeClient(round => [
      { type: 'tool_use', id: `call-${round}`, name: 'checkPattern', input: { index: round } },
      { type: 'done' }
    ])

    const result = await runReActLoop('system', tools, new Memory(), undefined, {
      client: client as never,
      guard
    })

    expect(guard.toolCalls).toBe(3)
    expect(execute).toHaveBeenCalledTimes(3)
    // 超出上限后不再继续调用工具，改为走强制总结
    expect(summary.calls).toBeGreaterThan(0)
    expect(result).toContain('issues')

    execute.mockRestore()
  })

  it('未传入 guard 时行为与治理前一致', async () => {
    const execute = vi.spyOn(toolRegistry, 'execute').mockResolvedValue('{"ok":true}')
    const { client } = createFakeClient(() => [
      { type: 'text', content: '已分析完成，无问题' },
      { type: 'done' }
    ])

    const result = await runReActLoop('system', tools, new Memory(), undefined, {
      client: client as never
    })

    expect(result).toContain('已分析完成')
    expect(execute).not.toHaveBeenCalled()

    execute.mockRestore()
  })
})
