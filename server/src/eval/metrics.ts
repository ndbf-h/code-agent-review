/** 检索评测指标（纯函数，手算样例见单测） */

/** Recall@K = 前 K 个结果中命中的期望文档数 / 期望文档总数 */
export function recallAtK(expectedIds: string[], retrievedIds: string[], k: number): number {
  if (expectedIds.length === 0) return 0
  const topK = retrievedIds.slice(0, k)
  const hit = expectedIds.filter(id => topK.includes(id)).length
  return hit / expectedIds.length
}

/** MRR = 首个相关结果排名的倒数（无相关结果记 0） */
export function mrr(expectedIds: string[], retrievedIds: string[]): number {
  for (let i = 0; i < retrievedIds.length; i++) {
    if (expectedIds.includes(retrievedIds[i])) {
      return 1 / (i + 1)
    }
  }
  return 0
}

export function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export function avg(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0
}
