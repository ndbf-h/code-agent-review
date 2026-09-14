import type { Tool } from '../../agent/tool-registry'
import { formatRetrievedContext, retrieveGuidelines } from './retriever'
import { retrieveGuidelinesHybrid } from './hybrid-retriever'
import { registerCustomGuidelines, getGuidelineDocuments } from './knowledge-base'

const retrieveCodingGuidelines: Tool = {
  definition: {
    name: 'retrieveCodingGuidelines',
    description:
      'Retrieve relevant coding standards and historical review guidance for the submitted code. Use before making a final review judgment.',
    parameters: {
      code: { type: 'string', description: 'Code or focused code fragment to review' },
      language: { type: 'string', description: 'Programming language' },
      dimension: { type: 'string', description: 'security, performance, style, or logic' },
      query: { type: 'string', description: 'Optional focused retrieval query' },
      topK: { type: 'number', description: 'Number of documents to return, from 1 to 8' },
      scopeId: { type: 'string', description: 'Knowledge scope for project-specific guidelines' }
    }
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const request = {
      code: String(input.code || ''),
      language: String(input.language || 'javascript'),
      dimension: input.dimension ? String(input.dimension) : undefined,
      query: input.query ? String(input.query) : undefined,
      topK: input.topK ? Number(input.topK) : 4,
      scopeId: input.scopeId ? String(input.scopeId) : undefined
    }
    // 默认混合检索（BM25+向量+RRF+重排，未配嵌入密钥时自动降级）；RAG_MODE=legacy 切回词元打分 baseline
    const results =
      process.env.RAG_MODE === 'legacy'
        ? retrieveGuidelines(request)
        : await retrieveGuidelinesHybrid(request)
    return JSON.stringify({
      results,
      context: formatRetrievedContext(results)
    })
  }
}

export {
  retrieveCodingGuidelines,
  retrieveGuidelines,
  retrieveGuidelinesHybrid,
  formatRetrievedContext,
  registerCustomGuidelines,
  getGuidelineDocuments
}
