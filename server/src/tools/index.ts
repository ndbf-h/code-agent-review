import { toolRegistry } from '../agent/tool-registry'
import { decomposeTask, assignAgent, collectResults, generateReport } from './orchestration'
import { analyzeCode, checkPattern, validateLogic } from './review'

function registerAllTools(): void {
  toolRegistry.register(decomposeTask)
  toolRegistry.register(assignAgent)
  toolRegistry.register(collectResults)
  toolRegistry.register(generateReport)

  toolRegistry.register(analyzeCode)
  toolRegistry.register(checkPattern)
  toolRegistry.register(validateLogic)

  console.log(`[tools] Registered ${toolRegistry.getDefinitions().length} tools`)
}

export { registerAllTools }
