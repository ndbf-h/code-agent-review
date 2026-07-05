import { Memory } from './memory'
import { runReActLoop } from './react-loop'
import { getRolePrompt } from './roles/index'
import { toolRegistry } from './tool-registry'
import { llmClient } from './llm-client'
import { createLogger } from '../logger'
import type { AgentRole, ReportContent, AgentResult, Issue } from '../../../shared/types'

const logger = createLogger('orchestrator')

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

/** Schema validator for structured output — checks issues is array and score is number */
function isValidIssueArray(data: unknown): data is { issues: Issue[]; score: number } {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  if (!Array.isArray(d.issues)) return false
  if (typeof d.score !== 'number') return false
  return true
}

async function runReviewTask(
  taskId: string,
  code: string,
  language: string,
  onEvent: (event: ReviewEvent) => void
): Promise<ReportContent> {
  logger.info('审查任务开始', { taskId, language, codeLength: code.length })
  onEvent({ type: 'orchestrator_start', message: '正在分析代码结构...' })

  // ═══════════════════════════════════════════════════════
  // Step 1: Code pre-analysis (NEW)
  // ═══════════════════════════════════════════════════════
  const lines = code.split('\n')
  const codeStats = {
    lines: lines.length,
    functions: (code.match(/\b(function|def|func|fn)\b/g) || []).length,
    hasDatabase: /\b(sql|query|database|db|select|insert|update|delete)\b/gi.test(code),
    hasHttp: /\b(http|fetch|axios|request|response|api)\b/gi.test(code),
    hasFileIO: /\b(fs\.|readFile|writeFile|open\()/gi.test(code)
  }

  logger.info('Code pre-analysis', { taskId, ...codeStats })

  // ═══════════════════════════════════════════════════════
  // Step 2: Orchestrator execution (streaming ReAct)
  // ═══════════════════════════════════════════════════════
  const orchRole = getRolePrompt('orchestrator')
  const orchTools = toolRegistry.getDefinitions().filter(t =>
    ['decomposeTask', 'assignAgent', 'collectResults', 'generateReport'].includes(t.name)
  )

  const orchMemory = new Memory()
  orchMemory.add({
    role: 'user',
    content: `Review this ${language} code (${codeStats.lines} lines, ~${codeStats.functions} functions):\n\`\`\`\n${code}\n\`\`\`\n\nPre-analysis: ${JSON.stringify(codeStats)}`
  })

  // Task 4.1 provides streaming via { stream: true } and thinking_token callback
  await runReActLoop(orchRole, orchTools, orchMemory, (type, arg1, arg2) => {
    if (type === 'thinking_token') {
      onEvent({ type: 'thinking_token', role: 'orchestrator', message: arg1 as string })
    } else if (type === 'thought') {
      onEvent({ type: 'agent_thought', role: 'orchestrator', message: arg1 as string })
    } else if (type === 'tool_call') {
      onEvent({
        type: 'tool_call',
        role: 'orchestrator',
        toolName: arg1 as string,
        input: arg2 as Record<string, unknown>
      })
    } else if (type === 'tool_result') {
      onEvent({
        type: 'tool_result',
        role: 'orchestrator',
        toolName: arg1 as string,
        output: typeof arg2 === 'string' ? arg2 : undefined
      })
    }
  }, { stream: true })

  onEvent({ type: 'task_decomposed', message: '正在分配审查任务...' })

  // ═══════════════════════════════════════════════════════
  // Step 3: Parallel reviewer execution (structured output)
  // ═══════════════════════════════════════════════════════
  const reviewerRoles: AgentRole[] = ['security', 'performance', 'style', 'logic']
  const reviewerResults: Record<string, { issues: Issue[]; score: number }> = {}

  await Promise.all(reviewerRoles.map(async (role) => {
    const reviewerId = `${role}-${taskId}`
    onEvent({ type: 'agent_start', agentId: reviewerId, role, message: `开始审查 ${role} 维度` })

    const rolePrompt = getRolePrompt(role)
    const reviewTools = toolRegistry.getDefinitions().filter(t =>
      ['analyzeCode', 'checkPattern', 'checkComplexity', 'validateSyntax'].includes(t.name)
    )

    const mem = new Memory()
    mem.add({
      role: 'user',
      content: `Review this ${language} code for ${role} issues (${codeStats.lines} lines):\n\`\`\`\n${code}\n\`\`\``
    })

    try {
      // ReAct loop with streaming — collect analysis info
      const result = await runReActLoop(rolePrompt, reviewTools, mem, (type, arg1, arg2) => {
        if (type === 'thinking_token') {
          onEvent({ type: 'thinking_token', agentId: reviewerId, role, message: arg1 as string })
        } else if (type === 'thought') {
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
      }, { stream: true })

      // Use structured output to parse review results
      try {
        const structured = await llmClient.chatStructured<{ issues: Issue[]; score: number }>(
          [
            { role: 'system', content: rolePrompt },
            {
              role: 'user',
              content: `Based on your analysis, output the final review result as JSON with an "issues" array and numeric "score":\n\`\`\`\n${code}\n\`\`\`\n\nAnalysis summary:\n${result.substring(0, 2000)}`
            }
          ]
        )
        if (!isValidIssueArray(structured)) {
          throw new Error('Structured output validation failed: issues must be array, score must be number')
        }
        reviewerResults[role] = structured
      } catch {
        // Structured output failed — fallback to regex JSON extraction from raw result
        let parsed: { issues: Issue[]; score: number } = { issues: [], score: 0 }
        try {
          let jsonStr = result
          const fenceMatch = result.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
          if (fenceMatch) jsonStr = fenceMatch[1]
          const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0])
          }
          if (!parsed.issues) parsed.issues = []
          if (typeof parsed.score !== 'number') parsed.score = 0
        } catch {
          // Final fallback: empty result
        }
        reviewerResults[role] = parsed
      }

      onEvent({ type: 'agent_done', agentId: reviewerId, role, message: `${role} 审查完成` })
      logger.info('审查员完成', { role, taskId })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      logger.error('审查员执行失败', { role, taskId, error: errorMsg })
      onEvent({ type: 'error', agentId: reviewerId, role, message: errorMsg })
      reviewerResults[role] = { issues: [], score: 0 }
    }
  }))

  // ═══════════════════════════════════════════════════════
  // Step 4: Generate final report
  // ═══════════════════════════════════════════════════════
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
