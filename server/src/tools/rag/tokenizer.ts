/**
 * 检索分词：ASCII 词元 + CJK 二元组（bigram）。
 * 词元打分 baseline 的已知缺陷是把 CJK 字符整体丢弃（中文查询零结果）；
 * 二元组是中文检索的常规做法，BM25 分支据此可命中含中文的内容。
 */
export function tokenizeForSearch(text: string): string[] {
  const normalized = text.toLowerCase()
  const asciiTokens = normalized.match(/[a-z0-9+#.]{2,}/g) || []

  const cjkRuns = normalized.match(/[\u4e00-\u9fff]+/g) || []
  const cjkTokens: string[] = []
  for (const run of cjkRuns) {
    if (run.length === 1) {
      cjkTokens.push(run)
      continue
    }
    for (let i = 0; i < run.length - 1; i++) {
      cjkTokens.push(run.slice(i, i + 2))
    }
  }
  return [...asciiTokens, ...cjkTokens]
}
