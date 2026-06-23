import { Memory } from './memory'
import { runReActLoop } from './react-loop'
import { getRolePrompt } from './roles/index'
import { toolRegistry } from './tool-registry'
import type { AgentRole, ReportContent, AgentResult } from '../../../shared/types'

interface ReviewEvent {
  type: string
  agentId?: string
  role?: string
  message?: string
  toolName?: string
  input?: Record<string, unknown>
  output?: string
  report?: ReportContent
}

async function runReviewTask(
  taskId: string,
  code: string,
  language: string,
  onEvent: (event: ReviewEvent) => void
): Promise<ReportContent> {
  onEvent({ type: 'orchestrator_start', message: '正在分析代码结构...' })

  const orchRole = getRolePrompt('orchestrator')
  const orchTools = toolRegistry.getDefinitions().filter(t =>
    ['decomposeTask', 'assignAgent', 'collectResults', 'generateReport'].includes(t.name)
  )

  const orchMemory = new Memory()
  orchMemory.add({
    role: 'user',
    content: `Review this ${language} code:\n\`\`\`\n${code}\n\`\`\``
  })

  await runReActLoop(orchRole, orchTools, orchMemory, (type, arg1, arg2) => {
    if (type === 'thought') {
      onEvent({ type: 'agent_thought', role: 'orchestrator', message: arg1 as string })
    } else if (type === 'tool_call') {
      onEvent({
        type: 'tool_call',
        role: 'orchestrator',
        toolName: arg1 as string,
        input: arg2 as Record<string, unknown>
      })
    }
  })

  onEvent({ type: 'task_decomposed', message: '正在分配审查任务...' })

  const reviewerRoles: AgentRole[] = ['security', 'performance', 'style', 'logic']
  const reviewerResults: Record<string, { issues: Array<{ line: number; severity: string; category: string; message: string; suggestion: string }>; score: number }> = {}

  await Promise.all(reviewerRoles.map(async (role) => {
    const reviewerId = `${role}-${taskId}`
    onEvent({ type: 'agent_start', agentId: reviewerId, role, message: `开始审查 ${role} 维度` })

    const rolePrompt = getRolePrompt(role)
    const reviewTools = toolRegistry.getDefinitions().filter(t =>
      ['analyzeCode', 'checkPattern', 'validateLogic'].includes(t.name)
    )

    const mem = new Memory()
    mem.add({
      role: 'user',
      content: `Review this ${language} code for ${role} issues:\n\`\`\`\n${code}\n\`\`\``
    })

    try {
      const result = await runReActLoop(rolePrompt, reviewTools, mem, (type, arg1, arg2) => {
        if (type === 'thought') {
          onEvent({ type: 'agent_thought', agentId: reviewerId, role, message: arg1 as string })
        } else if (type === 'tool_call') {
          onEvent({
            type: 'tool_call',
            agentId: reviewerId,
            role,
            toolName: arg1 as string,
            input: arg2 as Record<string, unknown>
          })
          onEvent({
            type: 'tool_result',
            agentId: reviewerId,
            role,
            toolName: arg1 as string
          })
        }
      })

      let parsed: { issues: Array<{ line: number; severity: string; category: string; message: string; suggestion: string }>; score: number }
      try {
        // 尝试从回复中提取 JSON（可能被包裹在 markdown 代码块中）
        let jsonStr = result
        const fenceMatch = result.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
        if (fenceMatch) {
          jsonStr = fenceMatch[1]
        }
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          jsonStr = jsonMatch[0]
        }
        parsed = JSON.parse(jsonStr)
        if (!parsed.issues) parsed.issues = []
        if (typeof parsed.score !== 'number') parsed.score = 0
      } catch {
        parsed = { issues: [], score: 0 }
      }

      reviewerResults[role] = parsed
      onEvent({ type: 'agent_done', agentId: reviewerId, role, message: `${role} 审查完成` })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      onEvent({ type: 'error', agentId: reviewerId, role, message: errorMsg })
      reviewerResults[role] = { issues: [], score: 0 }
    }
  }))

  onEvent({ type: 'orchestrator_summary', message: '正在生成审查报告...' })

  const allIssues: ReportContent['issues'] = Object.values(reviewerResults).flatMap(r =>
    r.issues.map(i => ({ ...i, severity: i.severity as ReportContent['issues'][0]['severity'] }))
  )

  const avgScore = Math.round(
    Object.values(reviewerResults).reduce((sum, r) => sum + r.score, 0) /
    Math.max(Object.values(reviewerResults).length, 1)
  )

  const report: ReportContent = {
    issues: allIssues,
    score: avgScore,
    agentResults: reviewerResults as unknown as Record<string, AgentResult>
  }

  onEvent({ type: 'report_ready', report })
  onEvent({ type: 'task_completed' })

  return report
}

export { runReviewTask }
export type { ReviewEvent }
