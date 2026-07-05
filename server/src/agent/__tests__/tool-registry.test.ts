import { describe, it, expect } from 'vitest'
import { ToolRegistry } from '../tool-registry'
import type { ToolDefinition } from '../types'

function createMockTool(name: string, result: string = 'mock result') {
  return {
    definition: {
      name,
      description: `Mock tool: ${name}`,
      parameters: { input: { type: 'string', description: 'input' } },
    } satisfies ToolDefinition,
    async execute(input: Record<string, unknown>): Promise<string> {
      return JSON.stringify({ result, input })
    },
  }
}

describe('ToolRegistry', () => {
  it('should register and retrieve a tool', () => {
    const registry = new ToolRegistry()
    const tool = createMockTool('testTool')
    registry.register(tool)

    const retrieved = registry.get('testTool')
    expect(retrieved).toBeDefined()
    expect(retrieved!.definition.name).toBe('testTool')
  })

  it('should execute a registered tool', async () => {
    const registry = new ToolRegistry()
    const tool = createMockTool('echo')
    registry.register(tool)

    const result = await registry.execute({ id: '1', name: 'echo', input: { message: 'hello' } })
    const parsed = JSON.parse(result)
    expect(parsed.result).toBe('mock result')
    expect(parsed.input).toEqual({ message: 'hello' })
  })

  it('should throw when executing an unknown tool', async () => {
    const registry = new ToolRegistry()

    await expect(
      registry.execute({ id: '1', name: 'nonExistent', input: {} })
    ).rejects.toThrow('Tool not found: nonExistent')
  })

  it('should return all definitions via getDefinitions', () => {
    const registry = new ToolRegistry()
    registry.register(createMockTool('toolA'))
    registry.register(createMockTool('toolB'))
    registry.register(createMockTool('toolC'))

    const definitions = registry.getDefinitions()
    expect(definitions).toHaveLength(3)
    expect(definitions.map(d => d.name)).toEqual(
      expect.arrayContaining(['toolA', 'toolB', 'toolC'])
    )
  })
})
