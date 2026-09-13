import { getGuidelineDocuments, type GuidelineDocument } from './knowledge-base'
import type { RetrievedGuideline } from './retriever'
import { buildBm25Index } from './bm25'
import {
  EmbeddingClient, cosineSimilarity, getEmbeddingConfig, getRerankConfig, rerankDocuments
} from './providers'

/**
 * 混合检索管线：BM25（CJK 感知分词）+ 向量召回（多语言嵌入，可选）→ RRF 融合 → 重排（可选）。
 *
 * - 向量分支是中英跨语言（中文查询 ↔ 英文知识库）的唯一桥梁，未配置 EMBEDDING_API_KEY 时
 *   自动退化为 BM25 单分支——此时中文查询对英文语料仍为零结果，属预期行为；
 * - 两个分支都无信号时不返回任何文档（保持 baseline 的零结果语义，避免硬凑）。
 */
const RRF_K = 60
const CANDIDATE_LIMIT = 10

/** RRF 融合（纯函数，导出供单测）：rankList 为各分支按得分降序的文档 id 序列 */
export function rrfFuse(rankLists: string[][], k = RRF_K): Map<string, number> {
  const scores = new Map<string, number>()
  for (const ranking of rankLists) {
    ranking.forEach((id, index) => {
      scores.set(id, (scores.get(id) || 0) + 1 / (k + index + 1))
    })
  }
  return scores
}

let embeddingClient: EmbeddingClient | null | undefined

function getEmbeddingClient(): EmbeddingClient | null {
  if (embeddingClient === undefined) {
    const config = getEmbeddingConfig()
    embeddingClient = config ? new EmbeddingClient(config) : null
  }
  return embeddingClient
}

function docSearchText(doc: GuidelineDocument): string {
  return `${doc.title}\n${doc.keywords.join(' ')}\n${doc.content}`
}

export async function retrieveGuidelinesHybrid(input: {
  code: string
  language: string
  dimension?: string
  query?: string
  topK?: number
  scopeId?: string
}): Promise<RetrievedGuideline[]> {
  const query = input.query || input.code
  const language = input.language.toLowerCase()
  const dimension = input.dimension
  const topK = Math.min(Math.max(input.topK || 4, 1), 8)

  const documents = getGuidelineDocuments(input.scopeId).filter(doc =>
    (!dimension || !doc.dimension || doc.dimension === dimension) &&
    (!doc.languages.length || doc.languages.includes(language) || doc.languages.includes('javascript'))
  )
  if (documents.length === 0) return []

  // ── 分支一：BM25 词元召回 ──
  const bm25 = buildBm25Index(documents.map(doc => ({ id: doc.id, text: docSearchText(doc) })))
  const bm25Scores = bm25.search(query)

  // ── 分支二：向量召回（可选，失败降级为单分支）──
  let cosineScores: Map<string, number> | null = null
  const client = getEmbeddingClient()
  if (client) {
    try {
      const [queryVector, docVectors] = await Promise.all([
        client.embed([query]),
        client.embed(documents.map(docSearchText))
      ])
      cosineScores = new Map(
        documents.map((doc, i) => [doc.id, cosineSimilarity(queryVector[0], docVectors[i])])
      )
    } catch (error) {
      console.warn('[rag:hybrid] 向量分支不可用，降级为 BM25 单分支:', error instanceof Error ? error.message : error)
    }
  }

  const hasSignal = (id: string) => (bm25Scores.get(id) || 0) > 0 || cosineScores !== null
  const candidates = documents.filter(doc => hasSignal(doc.id))
  if (candidates.length === 0) return []

  // ── RRF 融合 ──
  const byBm25 = [...candidates].sort((a, b) => (bm25Scores.get(b.id) || 0) - (bm25Scores.get(a.id) || 0)).map(d => d.id)
  const rankLists: string[][] = [byBm25]
  if (cosineScores) {
    rankLists.push([...candidates].sort((a, b) => (cosineScores!.get(b.id) || 0) - (cosineScores!.get(a.id) || 0)).map(d => d.id))
  }
  const fused = rrfFuse(rankLists)
  const fusedRanking = [...candidates]
    .sort((a, b) => (fused.get(b.id) || 0) - (fused.get(a.id) || 0))
    .slice(0, CANDIDATE_LIMIT)
    .map(d => d.id)

  // ── 重排（可选，失败保留 RRF 序）──
  let finalRanking = fusedRanking
  const rerankConfig = getRerankConfig()
  if (rerankConfig && fusedRanking.length > 1) {
    try {
      const docById = new Map<string, GuidelineDocument>(documents.map(d => [d.id, d] as [string, GuidelineDocument]))
      const texts = fusedRanking.map(id => docById.get(id)!.content)
      const scores = await rerankDocuments(query, texts, rerankConfig)
      finalRanking = fusedRanking
        .map((id, index) => ({ id, score: scores[index] }))
        .sort((a, b) => b.score - a.score)
        .map(item => item.id)
    } catch (error) {
      console.warn('[rag:hybrid] 重排不可用，保留 RRF 序:', error instanceof Error ? error.message : error)
    }
  }

  return finalRanking.slice(0, topK).map(id => {
    const doc = documents.find(d => d.id === id)!
    const rrfScore = fused.get(id) || 0
    // 展示分归一到 0~1：RRF 分数上限约为分支数/61
    const normalized = Math.min(1, rrfScore / (rankLists.length / (RRF_K + 1)))
    return {
      id: doc.id,
      title: doc.title,
      dimension: doc.dimension,
      source: doc.source,
      score: Number(normalized.toFixed(3)),
      content: doc.content
    }
  })
}
