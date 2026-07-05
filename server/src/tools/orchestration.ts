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
    // 占位：LLM 将基于输入代码动态填充 subTasks
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
    // 占位：LLM 将根据 agentRole 和 subTask 动态分配
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
    // 占位：LLM 将动态收集各 Agent 的审查结果
    return JSON.stringify({
      results: [
        {
          agentRole: 'security',
          findings: [
            { line: 0, severity: 'info', category: '待审查', message: '安全审查结果将由 security agent 填充', suggestion: '' }
          ]
        },
        {
          agentRole: 'performance',
          findings: [
            { line: 0, severity: 'info', category: '待审查', message: '性能审查结果将由 performance agent 填充', suggestion: '' }
          ]
        },
        {
          agentRole: 'style',
          findings: [
            { line: 0, severity: 'info', category: '待审查', message: '风格审查结果将由 style agent 填充', suggestion: '' }
          ]
        },
        {
          agentRole: 'logic',
          findings: [
            { line: 0, severity: 'info', category: '待审查', message: '逻辑审查结果将由 logic agent 填充', suggestion: '' }
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
    // 占位：LLM 将基于 reviews 结果动态生成报告
    return JSON.stringify({
      reportId: `report-${Date.now()}`,
      score: 0,
      summary: '报告将由 LLM 基于审查结果动态生成',
      issues: []
    })
  }
}

export { decomposeTask, assignAgent, collectResults, generateReport }
