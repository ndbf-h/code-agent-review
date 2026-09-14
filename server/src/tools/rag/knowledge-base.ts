export type GuidelineDimension = 'security' | 'performance' | 'style' | 'logic' | ''

export interface GuidelineDocument {
  id: string
  title: string
  dimension: GuidelineDimension
  languages: string[]
  keywords: string[]
  content: string
  source: string
  scopeId?: string
}

// Small, versioned seed knowledge base. Replace or extend these documents with
// team rules and historical review cases without changing the retriever API.
export const guidelineDocuments: GuidelineDocument[] = [
  {
    id: 'security-sql-injection',
    title: 'SQL injection prevention',
    dimension: 'security',
    languages: ['javascript', 'typescript', 'python', 'java', 'go'],
    keywords: [
      'sql',
      'query',
      'select',
      'insert',
      'update',
      'delete',
      'concat',
      'user input',
      'parameterized'
    ],
    content:
      'Never concatenate untrusted input into SQL. Use parameterized queries or a trusted query builder, validate input at the boundary, and keep database credentials outside source code.',
    source: 'internal/security/sql-injection.md'
  },
  {
    id: 'security-xss',
    title: 'Cross-site scripting prevention',
    dimension: 'security',
    languages: ['javascript', 'typescript', 'jsx', 'tsx'],
    keywords: [
      'xss',
      'html',
      'innerhtml',
      'v-html',
      'dangerouslysetinnerhtml',
      'escape',
      'sanitize'
    ],
    content:
      'Treat user-controlled text as untrusted. Prefer text rendering over raw HTML, and sanitize HTML with a maintained allowlist sanitizer before rendering it.',
    source: 'internal/security/xss.md'
  },
  {
    id: 'security-secrets',
    title: 'Secrets and credentials',
    dimension: 'security',
    languages: ['javascript', 'typescript', 'python', 'java', 'go'],
    keywords: ['api key', 'token', 'password', 'secret', 'credential', 'env', 'hardcoded'],
    content:
      'Do not commit API keys, tokens, passwords, or database credentials. Load secrets from environment variables or a secret manager and rotate exposed credentials immediately.',
    source: 'internal/security/secrets.md'
  },
  {
    id: 'performance-database-loop',
    title: 'Database access in loops',
    dimension: 'performance',
    languages: ['javascript', 'typescript', 'python', 'java', 'go'],
    keywords: ['database', 'query', 'loop', 'for', 'n+1', 'batch', 'cache'],
    content:
      'Avoid issuing one database query per loop iteration. Prefer batch queries, joins, bounded concurrency, or a carefully measured cache. Check both latency and memory impact.',
    source: 'internal/performance/database-loop.md'
  },
  {
    id: 'performance-complexity',
    title: 'Complexity and blocking work',
    dimension: 'performance',
    languages: ['javascript', 'typescript', 'python', 'java', 'go'],
    keywords: [
      'complexity',
      'nested loop',
      'blocking',
      'synchronous',
      'large array',
      'memory',
      'timeout'
    ],
    content:
      'Measure algorithmic complexity and input size before optimizing. Avoid synchronous I/O in request handlers, unbounded loops, and repeated work on large collections.',
    source: 'internal/performance/complexity.md'
  },
  {
    id: 'logic-null-errors',
    title: 'Null handling and error propagation',
    dimension: 'logic',
    languages: ['javascript', 'typescript', 'python', 'java', 'go'],
    keywords: ['null', 'undefined', 'optional', 'exception', 'error', 'catch', 'promise', 'async'],
    content:
      'Validate nullable inputs at boundaries. Do not silently swallow exceptions. Async operations must propagate or deliberately handle failures, and error paths should preserve enough context for diagnosis.',
    source: 'internal/logic/null-and-errors.md'
  },
  {
    id: 'logic-boundaries',
    title: 'Boundary conditions',
    dimension: 'logic',
    languages: ['javascript', 'typescript', 'python', 'java', 'go'],
    keywords: [
      'boundary',
      'index',
      'length',
      'items',
      'off-by-one',
      'empty',
      'range',
      'validation'
    ],
    content:
      'Check empty inputs, minimum and maximum values, array bounds, pagination boundaries, and repeated calls. Prefer explicit conditions that make the valid range clear.',
    source: 'internal/logic/boundaries.md'
  },
  {
    id: 'style-maintainability',
    title: 'Maintainable code structure',
    dimension: 'style',
    languages: ['javascript', 'typescript', 'python', 'java', 'go'],
    keywords: ['naming', 'function', 'long', 'nested', 'comment', 'duplication', 'maintainability'],
    content:
      'Use names that describe intent, keep functions focused, reduce deep nesting and duplication, and document non-obvious decisions rather than narrating obvious code.',
    source: 'internal/style/maintainability.md'
  }
]

const customGuidelineDocuments: GuidelineDocument[] = []

export function registerCustomGuidelines(documents: GuidelineDocument[]): void {
  customGuidelineDocuments.push(...documents)
}

export function getGuidelineDocuments(scopeId?: string): GuidelineDocument[] {
  return guidelineDocuments.concat(
    customGuidelineDocuments.filter(document => !document.scopeId || document.scopeId === scopeId)
  )
}
