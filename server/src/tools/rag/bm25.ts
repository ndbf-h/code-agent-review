import { tokenizeForSearch } from './tokenizer'

export interface Bm25Doc {
  id: string
  text: string
}

export interface Bm25Index {
  /** 返回每个文档的 BM25 得分（无匹配词的文档不在结果中） */
  search(query: string): Map<string, number>
}

const K1 = 1.5
const B = 0.75

/** 经典 BM25，语料为内存级小集合（指南文档），无需外部检索引擎 */
export function buildBm25Index(docs: Bm25Doc[]): Bm25Index {
  const docTokens = docs.map(doc => ({ id: doc.id, tokens: tokenizeForSearch(doc.text) }))
  const avgLength =
    docTokens.reduce((sum, d) => sum + d.tokens.length, 0) / Math.max(docTokens.length, 1)
  const docFreq = new Map<string, number>()
  for (const doc of docTokens) {
    for (const term of new Set(doc.tokens)) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1)
    }
  }

  return {
    search(query: string): Map<string, number> {
      const queryTerms = new Set(tokenizeForSearch(query))
      const scores = new Map<string, number>()
      for (const doc of docTokens) {
        const termFreq = new Map<string, number>()
        for (const token of doc.tokens) termFreq.set(token, (termFreq.get(token) || 0) + 1)
        let score = 0
        for (const term of queryTerms) {
          const tf = termFreq.get(term)
          if (!tf) continue
          const df = docFreq.get(term) || 0
          const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5))
          score +=
            (idf * (tf * (K1 + 1))) /
            (tf + K1 * (1 - B + (B * doc.tokens.length) / Math.max(avgLength, 1)))
        }
        if (score > 0) scores.set(doc.id, score)
      }
      return scores
    }
  }
}
