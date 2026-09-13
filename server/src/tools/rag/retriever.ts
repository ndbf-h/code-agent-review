import { getGuidelineDocuments, type GuidelineDimension, type GuidelineDocument } from './knowledge-base'

export interface RetrievedGuideline {
  id: string
  title: string
  dimension: GuidelineDimension
  source: string
  score: number
  content: string
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 2)
}

function scoreDocument(queryTokens: Set<string>, document: GuidelineDocument): number {
  const terms = new Set(tokenize(`${document.title} ${document.keywords.join(' ')} ${document.content}`))
  let matches = 0
  for (const token of queryTokens) {
    if (terms.has(token)) matches++
  }
  return matches / Math.max(queryTokens.size, 1)
}

export function retrieveGuidelines(input: {
  code: string
  language: string
  dimension?: string
  query?: string
  topK?: number
  scopeId?: string
}): RetrievedGuideline[] {
  const query = input.query || input.code
  const queryTokens = new Set(tokenize(query))
  const language = input.language.toLowerCase()
  const dimension = input.dimension as GuidelineDimension | undefined
  const topK = Math.min(Math.max(input.topK || 4, 1), 8)

  return getGuidelineDocuments(input.scopeId)
    .filter(document => !dimension || !document.dimension || document.dimension === dimension)
    .filter(document => !document.languages.length || document.languages.includes(language) || document.languages.includes('javascript'))
    .map(document => ({
      id: document.id,
      title: document.title,
      dimension: document.dimension,
      source: document.source,
      score: scoreDocument(queryTokens, document),
      content: document.content
    }))
    .filter(document => document.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(document => ({ ...document, score: Number(document.score.toFixed(3)) }))
}

export function formatRetrievedContext(results: RetrievedGuideline[]): string {
  if (results.length === 0) return 'No relevant coding guideline was retrieved.'
  return results.map((result, index) => [
    `[${index + 1}] ${result.title} (source: ${result.source}, relevance: ${result.score})`,
    result.content
  ].join('\n')).join('\n\n')
}
