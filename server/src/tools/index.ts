import { toolRegistry } from '../agent/tool-registry'
import type { Tool } from '../agent/tool-registry'
import { decomposeTask, assignAgent, collectResults, generateReport } from './orchestration'
import { analyzeCode, checkPattern, checkComplexity, validateSyntax } from './review'
import { applyFixes } from './fix'
import { retrieveCodingGuidelines } from './rag'

// 新增 readFile 工具
const readFile: Tool = {
  definition: {
    name: 'readFile',
    description: '读取用户提交的完整代码内容',
    parameters: {
      code: { type: 'string', description: '待读取的代码内容' }
    }
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const code = (input.code as string) || ''
    const lines = code.split('\n')
    return JSON.stringify({
      code,
      lines: lines.length,
      chars: code.length
    })
  }
}

function registerAllTools(): void {
  toolRegistry.register(readFile)

  toolRegistry.register(decomposeTask)
  toolRegistry.register(assignAgent)
  toolRegistry.register(collectResults)
  toolRegistry.register(generateReport)

  toolRegistry.register(analyzeCode)
  toolRegistry.register(checkPattern)
  toolRegistry.register(checkComplexity)
  toolRegistry.register(validateSyntax)

  toolRegistry.register(applyFixes)
  toolRegistry.register(retrieveCodingGuidelines)

  console.log(`[tools] Registered ${toolRegistry.getDefinitions().length} tools`)
}

export { registerAllTools }
