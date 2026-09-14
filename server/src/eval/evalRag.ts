import { retrieveGuidelines } from '../tools/rag/retriever'
import { retrieveGuidelinesHybrid } from '../tools/rag/hybrid-retriever'
import { getEmbeddingConfig, getRerankConfig } from '../tools/rag/providers'
import { loadJsonl, validateRagQuery } from './dataset'
import { avg, mrr, recallAtK } from './metrics'
import type { RagQueryResult, RagSuiteSummary, RagQueryType } from './types'

/**
 * RAG 检索评测：同一数据集分别跑 baseline（词元重合度打分）与 hybrid
 * （BM25+向量+RRF+重排），产出 before/after 对比——这是 P1-3 的验收依据。
 * baseline 零 LLM 成本；hybrid 未配嵌入密钥时为 BM25 单分支（报告中注明）。
 */
export async function runRagSuite(datasetPath: string): Promise<{
  baseline: { summary: RagSuiteSummary; results: RagQueryResult[] }
  hybrid: { summary: RagSuiteSummary; results: RagQueryResult[] }
  mode: { vectorBranch: boolean; rerankBranch: boolean }
}> {
  const queries = loadJsonl(datasetPath, validateRagQuery)
  const baselineResults: RagQueryResult[] = []
  const hybridResults: RagQueryResult[] = []

  for (const query of queries) {
    const request = {
      code: query.query,
      query: query.query,
      language: query.language || 'javascript',
      dimension: query.dimension,
      topK: 5,
      scopeId: 'eval-baseline'
    }

    const baselineIds = retrieveGuidelines(request).map(r => r.id)
    baselineResults.push(buildResult(query, baselineIds))

    const hybridIds = (await retrieveGuidelinesHybrid(request)).map(r => r.id)
    hybridResults.push(buildResult(query, hybridIds))
  }

  return {
    baseline: summarize(baselineResults),
    hybrid: summarize(hybridResults),
    mode: {
      vectorBranch: getEmbeddingConfig() !== null,
      rerankBranch: getRerankConfig() !== null
    }
  }
}

function buildResult(
  query: { id: string; type: RagQueryType; expectedDocIds: string[] },
  retrievedDocIds: string[]
): RagQueryResult {
  return {
    queryId: query.id,
    type: query.type,
    expectedDocIds: query.expectedDocIds,
    retrievedDocIds,
    recallAt5: recallAtK(query.expectedDocIds, retrievedDocIds, 5),
    mrr: mrr(query.expectedDocIds, retrievedDocIds),
    zeroResult: retrievedDocIds.length === 0
  }
}

function summarize(results: RagQueryResult[]): {
  summary: RagSuiteSummary
  results: RagQueryResult[]
} {
  const types = [...new Set(results.map(r => r.type))] as RagQueryType[]
  const byType = types.map(type => {
    const group = results.filter(r => r.type === type)
    return {
      type,
      queries: group.length,
      avgRecallAt5: avg(group.map(r => r.recallAt5)),
      avgMrr: avg(group.map(r => r.mrr))
    }
  })
  return {
    summary: {
      totalQueries: results.length,
      avgRecallAt5: avg(results.map(r => r.recallAt5)),
      avgMrr: avg(results.map(r => r.mrr)),
      zeroResultRate: results.filter(r => r.zeroResult).length / Math.max(results.length, 1),
      byType
    },
    results
  }
}
