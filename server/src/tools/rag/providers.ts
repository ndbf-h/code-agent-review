/**
 * 可选的向量与重排服务客户端（OpenAI 兼容 /embeddings + Jina/SiliconFlow 风格 /rerank）。
 * 未配置密钥时对应分支自动关闭——混合检索退化为 BM25 词元分支，系统照常运行。
 * 国内推荐 SiliconFlow（BAAI/bge-m3 多语言嵌入 + BAAI/bge-reranker-v2-m3 重排，有免费额度）。
 */

export interface EmbeddingConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export interface RerankConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export function getEmbeddingConfig(): EmbeddingConfig | null {
  const apiKey = process.env.EMBEDDING_API_KEY
  if (!apiKey) return null
  return {
    apiKey,
    baseUrl: (process.env.EMBEDDING_BASE_URL || 'https://api.siliconflow.cn/v1').replace(/\/$/, ''),
    model: process.env.EMBEDDING_MODEL || 'BAAI/bge-m3'
  }
}

export function getRerankConfig(): RerankConfig | null {
  const apiKey = process.env.RERANK_API_KEY
  if (!apiKey) return null
  return {
    apiKey,
    baseUrl: (process.env.RERANK_BASE_URL || 'https://api.siliconflow.cn/v1').replace(/\/$/, ''),
    model: process.env.RERANK_MODEL || 'BAAI/bge-reranker-v2-m3'
  }
}

/** 带缓存的嵌入客户端：文档向量只算一次，进程内复用 */
export class EmbeddingClient {
  private cache = new Map<string, number[]>()

  constructor(private readonly config: EmbeddingConfig) {}

  async embed(texts: string[]): Promise<number[][]> {
    const missing = texts.filter(text => !this.cache.has(text))
    if (missing.length > 0) {
      const response = await fetch(`${this.config.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({ model: this.config.model, input: missing })
      })
      if (!response.ok) {
        throw new Error(`Embedding API ${response.status}: ${(await response.text()).slice(0, 200)}`)
      }
      const data = await response.json() as { data: Array<{ index: number; embedding: number[] }> }
      for (const item of data.data) {
        this.cache.set(missing[item.index], item.embedding)
      }
    }
    return texts.map(text => this.cache.get(text)!)
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom > 0 ? dot / denom : 0
}

/** 重排：返回与 documents 下标对应的 relevance 分数（服务不可用时抛错，由调用方降级） */
export async function rerankDocuments(query: string, documents: string[], config: RerankConfig): Promise<number[]> {
  const response = await fetch(`${config.baseUrl}/rerank`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({ model: config.model, query, documents, top_n: documents.length })
  })
  if (!response.ok) {
    throw new Error(`Rerank API ${response.status}: ${(await response.text()).slice(0, 200)}`)
  }
  const data = await response.json() as { results: Array<{ index: number; relevance_score: number }> }
  const scores = new Array<number>(documents.length).fill(0)
  for (const item of data.results) {
    if (item.index >= 0 && item.index < documents.length) scores[item.index] = item.relevance_score
  }
  return scores
}
