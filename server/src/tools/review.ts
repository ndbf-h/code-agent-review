import type { Tool } from '../agent/tool-registry'

const analyzeCode: Tool = {
  definition: {
    name: 'analyzeCode',
    description: 'Analyze the code for issues in a specific dimension',
    parameters: {
      code: { type: 'string', description: 'The code to analyze' },
      dimension: { type: 'string', description: 'Review dimension: security, performance, style, logic' }
    }
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const dimension = input.dimension as string

    const mockResults: Record<string, object> = {
      security: {
        issues: [
          { line: 3, severity: 'critical', category: 'SQL Injection', message: 'String concatenation in SQL query', suggestion: 'Use parameterized queries' }
        ],
        score: 60
      },
      performance: {
        issues: [
          { line: 4, severity: 'warning', category: 'Query Optimization', message: 'Query inside function may cause N+1 problem', suggestion: 'Consider batching queries' }
        ],
        score: 80
      },
      style: {
        issues: [
          { line: 1, severity: 'suggestion', category: 'Type Annotation', message: 'Missing parameter type', suggestion: 'Add type annotation' },
          { line: 1, severity: 'suggestion', category: 'Naming', message: 'Unclear function name', suggestion: 'Use more descriptive name' }
        ],
        score: 70
      },
      logic: {
        issues: [
          { line: 2, severity: 'critical', category: 'Null Check', message: 'Parameter may be null', suggestion: 'Add null guard' }
        ],
        score: 75
      }
    }

    return JSON.stringify(mockResults[dimension] || { issues: [], score: 100 })
  }
}

const checkPattern: Tool = {
  definition: {
    name: 'checkPattern',
    description: 'Check code against a specific pattern or rule',
    parameters: {
      code: { type: 'string', description: 'The code to check' },
      pattern: { type: 'string', description: 'Pattern to check: sql_injection, xss, naming, null_check' }
    }
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const pattern = input.pattern as string

    const mockResults: Record<string, object> = {
      sql_injection: { matches: [{ line: 3, pattern: 'string concatenation in SQL', description: 'User input directly concatenated into SQL string' }], count: 1 },
      xss: { matches: [], count: 0 },
      naming: { matches: [{ line: 1, pattern: 'short name', description: "Function name 'getUser' could be more descriptive" }], count: 1 },
      null_check: { matches: [{ line: 2, pattern: 'missing null guard', description: 'No null/undefined check on parameter before use' }], count: 1 }
    }

    return JSON.stringify(mockResults[pattern] || { matches: [], count: 0 })
  }
}

const validateLogic: Tool = {
  definition: {
    name: 'validateLogic',
    description: 'Validate the logic and check edge cases in the code',
    parameters: {
      code: { type: 'string', description: 'The code to validate' }
    }
  },
  async execute(_input: Record<string, unknown>): Promise<string> {
    return JSON.stringify({
      edgeCases: ['null input', 'undefined input', 'empty string input', 'non-string input', 'SQL injection attempt'],
      covered: [false, false, false, false, false],
      suggestions: [
        'Add null guard at function entry',
        'Add type check for id parameter',
        'Use parameterized queries to prevent SQL injection'
      ]
    })
  }
}

export { analyzeCode, checkPattern, validateLogic }
