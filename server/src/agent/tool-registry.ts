import type { ToolDefinition, ToolCallRequest } from './types'
import { ToolError } from '../errors'

interface Tool {
  definition: ToolDefinition
  execute: (input: Record<string, unknown>) => Promise<string>
}

class ToolRegistry {
  private tools: Map<string, Tool> = new Map()
  private cache?: Map<string, { result: string; timestamp: number }>

  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition)
  }

  async execute(call: ToolCallRequest): Promise<string> {
    const tool = this.tools.get(call.name)
    if (!tool) {
      throw new ToolError(`Tool not found: ${call.name}`)
    }

    // 5 秒超时
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new ToolError(`Tool ${call.name} timed out after 5s`)), 5000)
    )

    const result = await Promise.race([tool.execute(call.input), timeout])

    // 简单内存缓存（基于工具名+参数 JSON key）
    const cacheKey = `${call.name}:${JSON.stringify(call.input)}`
    if (!this.cache) this.cache = new Map()
    this.cache.set(cacheKey, { result, timestamp: Date.now() })

    return result
  }

  /** 缓存查询方法（1分钟 TTL） */
  getCached(name: string, input: Record<string, unknown>): string | null {
    const cacheKey = `${name}:${JSON.stringify(input)}`
    const entry = this.cache?.get(cacheKey)
    if (entry && Date.now() - entry.timestamp < 60000) {
      return entry.result
    }
    return null
  }
}

const toolRegistry = new ToolRegistry()

export { type Tool, ToolRegistry, toolRegistry }
