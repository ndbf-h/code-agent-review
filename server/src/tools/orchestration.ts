import type { Tool } from '../agent/tool-registry'

const decomposeTask: Tool = {
  definition: {
    name: 'decomposeTask',
    description: '分析代码并将审查拆解为4个维度：安全、性能、风格、逻辑',
    parameters: {
      code: { type: 'string', description: '待审查的代码' },
      language: { type: 'string', description: '编程语言' }
    }
  },
  async execute(_input: Record<string, unknown>): Promise<string> {
    return JSON.stringify({
      dimensions: ['安全审查', '性能审查', '风格审查', '逻辑审查'],
      subTasks: [
        { dimension: 'security', description: '检查 SQL 注入、XSS、数据泄露、权限问题' },
        { dimension: 'performance', description: '检查 N+1 查询、循环复杂度、异步模式' },
        { dimension: 'style', description: '检查命名、注释、结构、错误处理' },
        { dimension: 'logic', description: '检查边界条件、空值安全、类型安全、边缘情况' }
      ]
    })
  }
}

const assignAgent: Tool = {
  definition: {
    name: 'assignAgent',
    description: '将子任务分配给对应专家 Agent',
    parameters: {
      agentRole: { type: 'string', description: 'Agent 角色：security、performance、style 或 logic' },
      subTask: { type: 'string', description: '子任务描述' }
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
    description: '收集所有 Agent 的审查结果',
    parameters: {
      taskId: { type: 'string', description: '任务 ID' }
    }
  },
  async execute(_input: Record<string, unknown>): Promise<string> {
    return JSON.stringify({
      results: [
        {
          agentRole: 'security',
          findings: [
            { line: 3, severity: 'critical', category: 'SQL 注入', message: '用户输入直接拼接到 SQL 查询', suggestion: '使用参数化查询' }
          ]
        },
        {
          agentRole: 'performance',
          findings: [
            { line: 4, severity: 'warning', category: '同步阻塞', message: '数据库查询可能阻塞事件循环', suggestion: '考虑使用异步查询方法' }
          ]
        },
        {
          agentRole: 'style',
          findings: [
            { line: 1, severity: 'suggestion', category: '类型注解', message: '函数参数缺少类型注解', suggestion: '添加显式类型：function getUser(id: string)' },
            { line: 1, severity: 'suggestion', category: '命名规范', message: '函数名不够清晰', suggestion: "建议改为 'getUserById'" }
          ]
        },
        {
          agentRole: 'logic',
          findings: [
            { line: 2, severity: 'critical', category: '空值安全', message: '参数 id 可能为 null 或 undefined', suggestion: '在函数入口添加空值检查' }
          ]
        }
      ]
    })
  }
}

const generateReport: Tool = {
  definition: {
    name: 'generateReport',
    description: '生成最终结构化审查报告',
    parameters: {
      taskId: { type: 'string', description: '任务 ID' },
      results: { type: 'string', description: '收集到的审查结果 JSON' }
    }
  },
  async execute(_input: Record<string, unknown>): Promise<string> {
    return JSON.stringify({
      reportId: `report-${Date.now()}`,
      score: 62,
      issues: [
        { line: 3, severity: 'critical', category: 'SQL 注入风险', message: '用户输入拼接到查询语句中', suggestion: '改用参数化查询' },
        { line: 2, severity: 'critical', category: '缺少空值检查', message: '参数可能为 null 或 undefined', suggestion: '在函数入口添加空值检查' },
        { line: 1, severity: 'warning', category: '缺少类型注解', message: '函数参数缺少显式类型', suggestion: '添加：function getUser(id: string)' },
        { line: 1, severity: 'suggestion', category: '命名规范', message: '建议使用更明确的命名', suggestion: "函数名改为 'getUserById'" }
      ]
    })
  }
}

export { decomposeTask, assignAgent, collectResults, generateReport }
