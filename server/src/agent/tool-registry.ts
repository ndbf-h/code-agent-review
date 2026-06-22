import type { ToolDefinition, ToolCallRequest } from './types'

interface Tool {
  definition: ToolDefinition
  execute: (input: Record<string, unknown>) => Promise<string>
}

class ToolRegistry {
  private tools: Map<string, Tool> = new Map()

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
      throw new Error(`Tool not found: ${call.name}`)
    }
    return tool.execute(call.input)
  }
}

const toolRegistry = new ToolRegistry()

export { type Tool, ToolRegistry, toolRegistry }
