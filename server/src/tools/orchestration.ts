import type { Tool } from '../agent/tool-registry'

const decomposeTask: Tool = {
  definition: {
    name: 'decomposeTask',
    description: 'Analyze code and decompose the review into 4 dimensions',
    parameters: {
      code: { type: 'string', description: 'The code to review' },
      language: { type: 'string', description: 'The programming language' }
    }
  },
  async execute(_input: Record<string, unknown>): Promise<string> {
    return JSON.stringify({
      dimensions: ['security', 'performance', 'style', 'logic'],
      subTasks: [
        { dimension: 'security', description: 'Check SQL injection, XSS, data exposure, auth issues' },
        { dimension: 'performance', description: 'Check N+1 queries, loop complexity, async patterns' },
        { dimension: 'style', description: 'Check naming, comments, structure, error handling' },
        { dimension: 'logic', description: 'Check boundaries, null safety, type safety, edge cases' }
      ]
    })
  }
}

const assignAgent: Tool = {
  definition: {
    name: 'assignAgent',
    description: 'Assign a sub-task to a specialist agent',
    parameters: {
      agentRole: { type: 'string', description: 'Agent role: security, performance, style, or logic' },
      subTask: { type: 'string', description: 'Description of the sub-task' }
    }
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    return JSON.stringify({
      agentId: `agent-${input.agentRole}-${Date.now()}`,
      assigned: true,
      task: input.subTask
    })
  }
}

const collectResults: Tool = {
  definition: {
    name: 'collectResults',
    description: 'Collect all review findings from agents',
    parameters: {
      taskId: { type: 'string', description: 'The task ID' }
    }
  },
  async execute(_input: Record<string, unknown>): Promise<string> {
    return JSON.stringify({
      results: [
        {
          agentRole: 'security',
          findings: [
            { line: 3, severity: 'critical', category: 'SQL Injection', message: 'User input concatenated into SQL query', suggestion: 'Use parameterized queries' }
          ]
        },
        {
          agentRole: 'performance',
          findings: [
            { line: 4, severity: 'warning', category: 'Synchronous Blocking', message: 'Database query may block the event loop', suggestion: 'Consider using async query method' }
          ]
        },
        {
          agentRole: 'style',
          findings: [
            { line: 1, severity: 'suggestion', category: 'Type Annotation', message: 'Missing type annotation on parameter', suggestion: 'Add explicit type: function getUser(id: string)' },
            { line: 1, severity: 'suggestion', category: 'Naming', message: 'Function name could be more descriptive', suggestion: "Rename to 'getUserById'" }
          ]
        },
        {
          agentRole: 'logic',
          findings: [
            { line: 2, severity: 'critical', category: 'Null Safety', message: 'Parameter id may be null or undefined', suggestion: 'Add a guard clause at function entry' }
          ]
        }
      ]
    })
  }
}

const generateReport: Tool = {
  definition: {
    name: 'generateReport',
    description: 'Generate the final structured review report',
    parameters: {
      taskId: { type: 'string', description: 'The task ID' },
      results: { type: 'string', description: 'JSON string of collected results' }
    }
  },
  async execute(_input: Record<string, unknown>): Promise<string> {
    return JSON.stringify({
      reportId: `report-${Date.now()}`,
      score: 62,
      issues: [
        { line: 3, severity: 'critical', category: 'SQL Injection Risk', message: 'User input concatenated into query string', suggestion: 'Use parameterized queries instead' },
        { line: 2, severity: 'critical', category: 'Missing Null Check', message: "Parameter 'id' may be undefined or null", suggestion: 'Add guard clause at function entry' },
        { line: 1, severity: 'warning', category: 'Missing Type Annotation', message: 'Function parameter lacks explicit type', suggestion: 'Add: function getUser(id: string)' },
        { line: 1, severity: 'suggestion', category: 'Naming Convention', message: "Consider 'getUserById' for clarity", suggestion: "Rename function to 'getUserById'" }
      ]
    })
  }
}

export { decomposeTask, assignAgent, collectResults, generateReport }
