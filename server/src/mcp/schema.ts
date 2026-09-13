/** MCP 工具名 → 必填参数表（基于各工具 execute 的实际消费语义手工标注） */
export const REQUIRED_PARAMS: Record<string, string[]> = {
  readFile: ['code'],
  decomposeTask: ['code'],
  assignAgent: ['dimension', 'preScanFindings'],
  collectResults: ['dimensionResults'],
  generateReport: ['collectionResult'],
  analyzeCode: ['code', 'dimension'],
  checkPattern: ['code', 'pattern'],
  checkComplexity: ['code'],
  validateSyntax: ['code', 'language'],
  applyFixes: ['code', 'issues'],
  retrieveCodingGuidelines: []
}

/** 产生 LLM 成本或非确定输出的工具：MCP annotations 提示客户端（如 Claude Code）按需确认 */
export const NON_READONLY_TOOLS = new Set(['applyFixes'])

export interface JsonSchemaProperty {
  type: string
  description?: string
}

/**
 * 项目 ToolDefinition.parameters 的约定结构（{ [name]: { type, description } }）
 * → JSON Schema（MCP inputSchema 要求）。纯函数。
 */
export function toInputSchema(
  name: string,
  parameters: Record<string, unknown>
): { type: 'object'; properties: Record<string, JsonSchemaProperty>; required: string[] } {
  const properties: Record<string, JsonSchemaProperty> = {}
  for (const [key, value] of Object.entries(parameters || {})) {
    const spec = (value && typeof value === 'object' ? value : {}) as { type?: unknown; description?: unknown }
    properties[key] = {
      type: typeof spec.type === 'string' ? spec.type : 'string',
      ...(typeof spec.description === 'string' ? { description: spec.description } : {})
    }
  }
  return {
    type: 'object',
    properties,
    required: REQUIRED_PARAMS[name] || []
  }
}
