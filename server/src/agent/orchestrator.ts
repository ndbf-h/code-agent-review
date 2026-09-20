import { Memory } from './memory'
import { runReActLoop, type ToolCallGuard } from './react-loop'
import { createTaskBudget } from './budget'
import { getConfig } from '../config'
import { getRolePrompt } from './roles/index'
import { toolRegistry } from './tool-registry'
import { getClientForRole } from './role-router'
import { getRulesByDimension, scanCode } from '../tools/rules'
import { createLogger } from '../logger'
import { createInsertMessageFn } from './persistence'
import { withReviewerSpan } from '../observability/tracing'
import { detectInjection, redactSecrets, wrapUntrustedCode } from '../security/prompt-guard'
import type {
  AgentRole,
  ReportContent,
  AgentResult,
  Issue,
  ReviewConfig,
  ReviewDimension
} from '../../../shared/types'

const logger = createLogger('orchestrator')
const insertMessageFn = createInsertMessageFn()

// ── 可观测性：Agent 延迟计时 ──

interface AgentLatency {
  preScan: number
  orchestration: number
  reviewers: Record<string, number>
  reportGeneration: number
  total: number
}

let agentLatency: AgentLatency = {
  preScan: 0,
  orchestration: 0,
  reviewers: {},
  reportGeneration: 0,
  total: 0
}

/** 获取最近一次审查各阶段耗时（ms） */
export function getAgentLatency() {
  return {
    preScan: agentLatency.preScan,
    orchestration: agentLatency.orchestration,
    reviewers: { ...agentLatency.reviewers },
    reportGeneration: agentLatency.reportGeneration,
    total: agentLatency.total
  }
}

/** 重置延迟计时器 */
export function resetAgentLatency() {
  agentLatency = {
    preScan: 0,
    orchestration: 0,
    reviewers: {},
    reportGeneration: 0,
    total: 0
  }
}

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

/** Schema validator for structured output */
function isValidIssueArray(data: unknown): data is { issues: Issue[]; score: number } {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  if (!Array.isArray(d.issues)) return false
  if (typeof d.score !== 'number') return false
  return true
}

/** Result from a single reviewer, including the execution method */
interface ReviewerResult {
  issues: Issue[]
  score: number
  method: 'llm' | 'rule-fallback'
}

/** Run a single reviewer with the given role and context */
async function runReviewer(
  role: AgentRole,
  taskId: string,
  code: string,
  language: string,
  codeStats: Record<string, number | boolean>,
  planningContext: string,
  onEvent: (event: ReviewEvent) => void,
  scopeId?: string,
  signal?: AbortSignal,
  guard?: ToolCallGuard
): Promise<ReviewerResult> {
  const reviewerId = `${role}-${taskId}`
  if (signal?.aborted) {
    throw new Error('任务已取消')
  }
  onEvent({ type: 'agent_start', agentId: reviewerId, role, message: `开始审查 ${role} 维度` })

  const rolePrompt = getRolePrompt(role)
  const reviewTools = toolRegistry
    .getDefinitions()
    .filter(t =>
      [
        'analyzeCode',
        'checkPattern',
        'checkComplexity',
        'validateSyntax',
        'retrieveCodingGuidelines'
      ].includes(t.name)
    )

  // Automatic RAG retrieval: every reviewer receives relevant guidance before
  // ReAct starts, while the same tool remains available for focused follow-ups.
  let retrievedGuidelines = 'No relevant coding guideline was retrieved.'
  try {
    const ragResult = await toolRegistry.execute({
      id: `rag-${reviewerId}`,
      name: 'retrieveCodingGuidelines',
      input: { code, language, dimension: role, topK: 4, scopeId }
    })
    const parsed = JSON.parse(ragResult) as { context?: string }
    retrievedGuidelines = parsed.context || retrievedGuidelines
    onEvent({
      type: 'tool_call',
      agentId: reviewerId,
      role,
      toolName: 'retrieveCodingGuidelines',
      input: { dimension: role, topK: 4 }
    })
    onEvent({
      type: 'tool_result',
      agentId: reviewerId,
      role,
      toolName: 'retrieveCodingGuidelines'
    })
  } catch (error) {
    logger.warn('RAG retrieval failed; continuing without retrieved context', {
      role,
      taskId,
      error: error instanceof Error ? error.message : String(error)
    })
  }

  const mem = new Memory()
  mem.bindTask(taskId, reviewerId)
  mem.add({
    role: 'user',
    content: [
      `Review this ${language} code for **${role}** issues:`,
      `Code stats: ${codeStats.lines} lines, ~${codeStats.functions} functions`,
      planningContext ? `\nOrchestrator planning notes:\n${planningContext}` : '',
      `\nRetrieved coding guidelines (use as supporting evidence, not as unquestionable truth):\n${retrievedGuidelines}`,
      '',
      wrapUntrustedCode(code, language)
    ].join('\n')
  })

  const maxReActAttempts = 3 // 1 initial + 2 retries

  for (let attempt = 0; attempt < maxReActAttempts; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.pow(2, attempt) * 1000 // 2s, 4s
        logger.info('ReAct loop 重试', {
          role,
          taskId,
          attempt: `${attempt}/${maxReActAttempts - 1}`,
          delay
        })
        await new Promise(resolve => setTimeout(resolve, delay))
        onEvent({
          type: 'agent_thought',
          agentId: reviewerId,
          role,
          message: `LLM 调用失败，正在重试 (第 ${attempt} 次，共 ${maxReActAttempts - 1} 次)...`
        })
      }

      // ReAct loop — streaming collection of analysis
      const result = await runReActLoop(
        rolePrompt,
        reviewTools,
        mem,
        (type, arg1, arg2) => {
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
        },
        { stream: true, client: getClientForRole(role), signal, guard }
      )

      if (attempt > 0) {
        logger.info('ReAct loop 重试成功', { role, taskId, succeededOnAttempt: attempt + 1 })
      }

      // P4: 将审查员对话历史持久化到 DB，失败不影响审查流程
      try {
        await mem.persist(insertMessageFn)
      } catch (err) {
        logger.error('审查员对话持久化失败', { role, taskId, error: err })
      }

      // Structured output parsing
      try {
        const structured = await getClientForRole(role).chatStructured<{
          issues: Issue[]
          score: number
        }>([
          { role: 'system', content: rolePrompt },
          {
            role: 'user',
            content: `Based on your analysis, output the final review result as JSON with an "issues" array and numeric "score":\n${wrapUntrustedCode(code, language)}\n\nAnalysis summary:\n${result.substring(0, 2000)}`
          }
        ])
        if (!isValidIssueArray(structured)) {
          throw new Error('Structured output validation failed')
        }
        onEvent({
          type: 'agent_done',
          agentId: reviewerId,
          role,
          message: `${role} 审查完成（${structured.issues.length} 个问题）`
        })
        logger.info('审查员完成', {
          role,
          taskId,
          issueCount: structured.issues.length,
          retryAttempts: attempt
        })
        return { ...structured, method: 'llm' as const }
      } catch {
        // Fallback: regex JSON extraction from raw result
        let parsed: { issues: Issue[]; score: number } = { issues: [], score: 0 }
        try {
          let jsonStr = result
          const fenceMatch = result.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
          if (fenceMatch) jsonStr = fenceMatch[1]
          const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
          if (jsonMatch) parsed = JSON.parse(jsonMatch[0])
          if (!parsed.issues) parsed.issues = []
          if (typeof parsed.score !== 'number') parsed.score = 0
        } catch {
          // Final fallback: empty result
        }
        onEvent({
          type: 'agent_done',
          agentId: reviewerId,
          role,
          message: `${role} 审查完成（${parsed.issues.length} 个问题）`
        })
        logger.info('审查员完成（结构化解析回退）', {
          role,
          taskId,
          issueCount: parsed.issues.length,
          retryAttempts: attempt
        })
        return { ...parsed, method: 'llm' as const }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      logger.warn('ReAct loop 执行失败', {
        role,
        taskId,
        attempt: attempt + 1,
        maxAttempts: maxReActAttempts,
        error: errorMsg
      })

      // REQ-11：工具调用已达上限时不再重试，避免外层重试与内层轮次叠加
      if (guard && guard.maxToolCalls > 0 && guard.toolCalls >= guard.maxToolCalls) {
        logger.warn('工具调用已达上限，放弃重试并回退规则引擎', {
          role,
          taskId,
          toolCalls: guard.toolCalls
        })
        break
      }

      // 还有重试机会，继续循环
      if (attempt < maxReActAttempts - 1) continue

      // 所有重试耗尽
      logger.error('审查员执行失败，重试耗尽，回退到规则引擎', {
        role,
        taskId,
        totalAttempts: maxReActAttempts,
        error: errorMsg
      })
    }
  }

  // ═══════════════════════════════════════════════════════
  // P1: 降级到纯规则引擎回退（所有重试耗尽后）
  // ═══════════════════════════════════════════════════════
  onEvent({
    type: 'agent_thought',
    agentId: reviewerId,
    role,
    message: `LLM 调用失败（已重试 ${maxReActAttempts - 1} 次），回退到规则引擎分析...`
  })
  try {
    const fallbackResult = runRuleOnlyReview(role, code, language)
    onEvent({
      type: 'agent_done',
      agentId: reviewerId,
      role,
      message: `${role} 审查完成（规则引擎回退，${fallbackResult.issues.length} 个问题）`
    })
    return { ...fallbackResult, method: 'rule-fallback' as const }
  } catch (fallbackError) {
    const errorMsg = fallbackError instanceof Error ? fallbackError.message : 'Unknown error'
    onEvent({ type: 'error', agentId: reviewerId, role, message: errorMsg })
    return { issues: [], score: 0, method: 'rule-fallback' as const }
  }
}

/** P1: 纯规则引擎降级审查（LLM 不可用时的回退） */
function runRuleOnlyReview(
  role: AgentRole,
  code: string,
  language?: string
): { issues: Issue[]; score: number } {
  const dimensionMap: Record<string, string> = {
    security: 'security',
    performance: 'performance',
    style: 'style',
    logic: 'logic'
  }
  const dimension = dimensionMap[role] || 'style'
  const rules = getRulesByDimension(dimension)
  const matches = scanCode(code, rules, language)

  const criticalCount = matches.filter(m => m.severity === 'critical').length
  const warningCount = matches.filter(m => m.severity === 'warning').length
  const suggestionCount = matches.filter(m => m.severity === 'suggestion').length
  const score = Math.max(0, 100 - criticalCount * 15 - warningCount * 8 - suggestionCount * 3)

  return {
    issues: matches.map(m => ({
      line: m.line,
      severity: m.severity,
      category: `[规则引擎] ${m.category}`,
      message: m.message,
      suggestion: m.suggestion
    })),
    score
  }
}

// ═══════════════════════════════════════════════════════════════
// 主编排函数
// ═══════════════════════════════════════════════════════════════

const ALL_REVIEWER_ROLES: AgentRole[] = ['security', 'performance', 'style', 'logic']

/** REQ-14：解析本次请求要运行的审查维度（未指定则四个维度全跑） */
export function resolveReviewerRoles(reviewConfig?: ReviewConfig): AgentRole[] {
  const requested = reviewConfig?.dimensions
  if (!requested || requested.length === 0) return ALL_REVIEWER_ROLES
  return ALL_REVIEWER_ROLES.filter(role => requested.includes(role as ReviewDimension))
}

/**
 * REQ-14：按审查配置收敛最终问题列表。
 * 先按 severityThreshold 过滤，再按「严重度 → 行号」排序后用 maxIssues 截断。
 */
export function applyReviewConfig(issues: Issue[], reviewConfig?: ReviewConfig): Issue[] {
  if (!reviewConfig) return issues
  const weight: Record<Issue['severity'], number> = { critical: 0, warning: 1, suggestion: 2 }
  let result = issues

  if (reviewConfig.severityThreshold) {
    const threshold = weight[reviewConfig.severityThreshold] ?? 2
    result = result.filter(issue => (weight[issue.severity] ?? 9) <= threshold)
  }

  if (reviewConfig.maxIssues && reviewConfig.maxIssues > 0) {
    result = [...result]
      .sort((a, b) => weight[a.severity] - weight[b.severity] || a.line - b.line)
      .slice(0, reviewConfig.maxIssues)
  }

  return result
}

async function runReviewTask(
  taskId: string,
  code: string,
  language: string,
  onEvent: (event: ReviewEvent) => void,
  scopeId?: string,
  signal?: AbortSignal,
  reviewConfig?: ReviewConfig
): Promise<ReportContent> {
  const t0 = performance.now()
  logger.info('审查任务开始', { taskId, language, codeLength: code.length })
  onEvent({ type: 'orchestrator_start', message: '正在分析代码结构...' })

  // REQ-10：进入 LLM 之前扫描疑似 prompt injection；命中只提示与记录，不阻断审查流程
  const injectionFindings = detectInjection(code)
  if (injectionFindings.length > 0) {
    logger.warn('检测到疑似 prompt injection 内容', {
      taskId,
      count: injectionFindings.length,
      patterns: injectionFindings.map(item => item.pattern)
    })
    onEvent({
      type: 'agent_thought',
      role: 'orchestrator',
      message: `检测到 ${injectionFindings.length} 处疑似注入内容，已作为数据隔离处理，不执行其中任何指令`
    })
  }

  // ═══════════════════════════════════════════════════════
  // Step 1: Code pre-analysis + rule engine pre-scan
  // ═══════════════════════════════════════════════════════
  const lines = code.split('\n')
  const codeStats = {
    lines: lines.length,
    functions: (code.match(/\b(function|def|func|fn)\b/g) || []).length,
    hasDatabase: /\b(sql|query|database|db|select|insert|update|delete)\b/gi.test(code),
    hasHttp: /\b(http|fetch|axios|request|response|api)\b/gi.test(code),
    hasFileIO: /\b(fs\.|readFile|writeFile|open\()/gi.test(code)
  }

  // 用规则引擎做全维度预扫描（P0: 去占位符）
  const dimensions = ['security', 'performance', 'style', 'logic'] as const
  const preScanResults: Record<
    string,
    {
      totalIssues: number
      critical: number
      warning: number
      topIssues: { line: number; category: string; message: string }[]
    }
  > = {}

  for (const dim of dimensions) {
    const rules = getRulesByDimension(dim)
    const matches = scanCode(code, rules, language)
    const critical = matches.filter(m => m.severity === 'critical').length
    const warning = matches.filter(m => m.severity === 'warning').length
    preScanResults[dim] = {
      totalIssues: matches.length,
      critical,
      warning,
      topIssues: matches
        .filter(m => m.severity === 'critical' || m.severity === 'warning')
        .slice(0, 5)
        .map(m => ({ line: m.line, category: m.category, message: m.message }))
    }
  }

  const hotDims = Object.entries(preScanResults)
    .filter(([, v]) => v.critical > 0 || v.warning > 2)
    .sort(([, a], [, b]) => b.critical - a.critical || b.warning - a.warning)

  logger.info('Code pre-analysis', { taskId, ...codeStats, hotDimensions: hotDims.map(([k]) => k) })

  const t1 = performance.now()
  agentLatency.preScan = Math.round(t1 - t0)

  // ═══════════════════════════════════════════════════════
  // Step 2: Orchestrator ReAct loop (planning with real data)
  // ═══════════════════════════════════════════════════════
  const orchRole = getRolePrompt('orchestrator')
  const orchTools = toolRegistry
    .getDefinitions()
    .filter(t => ['decomposeTask', 'assignAgent'].includes(t.name))

  const orchMemory = new Memory()
  orchMemory.bindTask(taskId, `orchestrator-${taskId}`)
  orchMemory.add({
    role: 'user',
    content: [
      `You are orchestrating a code review for this ${language} code:`,
      `- ${codeStats.lines} lines, ~${codeStats.functions} functions`,
      `- Has DB operations: ${codeStats.hasDatabase}`,
      `- Has HTTP calls: ${codeStats.hasHttp}`,
      `- Has file I/O: ${codeStats.hasFileIO}`,
      ``,
      `Rule engine pre-scan results:`,
      ...Object.entries(preScanResults).map(
        ([dim, r]) =>
          `  ${dim}: ${r.totalIssues} issues (${r.critical} critical, ${r.warning} warning)`
      ),
      hotDims.length > 0
        ? `\nHot dimensions to prioritize: ${hotDims.map(([k]) => k).join(', ')}`
        : '',
      `\nUse decomposeTask to get detailed findings, then plan the review strategy.`,
      '',
      wrapUntrustedCode(code, language)
    ].join('\n')
  })

  // Collect planning notes from orchestrator
  let planningNotes = ''

  if (signal?.aborted) {
    throw new Error('任务已取消')
  }
  await runReActLoop(
    orchRole,
    orchTools,
    orchMemory,
    (type, arg1, arg2) => {
      if (type === 'thinking_token') {
        onEvent({ type: 'thinking_token', role: 'orchestrator', message: arg1 as string })
      } else if (type === 'thought') {
        planningNotes += ((arg2 as string) || (arg1 as string) || '') + '\n'
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
    },
    { stream: true }
  )

  // P4: 将编排器对话历史持久化到 DB，失败不影响审查流程
  try {
    await orchMemory.persist(insertMessageFn)
  } catch (err) {
    logger.error('编排器对话持久化失败', { taskId, error: err })
  }

  const t2 = performance.now()
  agentLatency.orchestration = Math.round(t2 - t1)

  onEvent({ type: 'task_decomposed', message: '正在分配审查任务...' })

  // ═══════════════════════════════════════════════════════
  // Step 3: Parallel reviewer execution (allSettled — 单个失败不影响其他)
  // ═══════════════════════════════════════════════════════
  // REQ-14：只运行请求指定的维度；未指定则四个维度全跑
  const reviewerRoles = resolveReviewerRoles(reviewConfig)
  const reviewerResults: Record<string, { issues: Issue[]; score: number }> = {}
  const reviewStatus: Record<string, 'success' | 'fallback' | 'failed'> = {}

  // REQ-11：每个 reviewer 一份治理计数器（该 reviewer 的重试共享），另加任务级 token 预算
  const config = getConfig()
  const guards: Record<string, ToolCallGuard> = {}
  const budget = createTaskBudget(config.agent.taskTokenBudget)
  let budgetExceeded = false

  // 为每个 reviewer 记录开始时间
  const reviewerStartTimes: Record<string, number> = {}

  // 为每个 reviewer 生成针对性规划上下文
  function buildPlanningContext(role: string): string {
    const preScan = preScanResults[role]
    // REQ-14：自定义要求经定界包裹后注入，仅作为审查关注点，不改变角色与输出格式
    const extraInstructions = reviewConfig?.instructions
      ? ['用户补充要求：', wrapUntrustedCode(reviewConfig.instructions, 'text')].join('\n')
      : ''
    if (!preScan) {
      return [planningNotes.substring(0, 500), extraInstructions].filter(Boolean).join('\n')
    }
    const parts = [
      `Pre-scan found ${preScan.totalIssues} potential issues (${preScan.critical} critical, ${preScan.warning} warning)`,
      preScan.topIssues.length > 0
        ? `Top concerns: ${preScan.topIssues.map(i => `L${i.line}: ${i.message}`).join('; ')}`
        : '',
      planningNotes ? `\nOrchestrator notes: ${planningNotes.substring(0, 300)}` : '',
      extraInstructions
    ]
    return parts.filter(Boolean).join('\n')
  }

  const settledResults = await Promise.allSettled(
    reviewerRoles.map(async role => {
      reviewerStartTimes[role] = performance.now()
      const context = buildPlanningContext(role)
      const guard: ToolCallGuard = {
        repeatThreshold: config.agent.reactRepeatThreshold,
        maxToolCalls: config.agent.reactMaxToolCalls,
        loopBreaks: 0,
        toolCalls: 0
      }
      guards[role] = guard
      const reviewerId = `${role}-${taskId}`

      const result = await withReviewerSpan(role, async () => {
        // REQ-11：预算耗尽后不再调用 LLM，该维度直接使用规则引擎
        if (budget.isExceeded()) {
          budgetExceeded = true
          onEvent({
            type: 'agent_thought',
            agentId: reviewerId,
            role,
            message: '已超出任务 token 预算，改由规则引擎完成本次审查'
          })
          const fallback = runRuleOnlyReview(role, code, language)
          onEvent({
            type: 'agent_done',
            agentId: reviewerId,
            role,
            message: `${role} 审查完成（预算降级，${fallback.issues.length} 个问题）`
          })
          return { ...fallback, method: 'rule-fallback' as const }
        }

        return runReviewer(
          role,
          taskId,
          code,
          language,
          codeStats,
          context,
          onEvent,
          scopeId,
          signal,
          guard
        )
      })
      agentLatency.reviewers[role] = Math.round(performance.now() - reviewerStartTimes[role])
      return { role, result }
    })
  )

  // 取消优先于逐 reviewer 容错：abort 信号一旦置位，整个任务立即中止
  if (signal?.aborted) {
    throw new Error('任务已取消')
  }

  // 处理各 reviewer 结果，跟踪成功/降级/失败状态
  settledResults.forEach((r, idx) => {
    const role = reviewerRoles[idx]
    if (r.status === 'fulfilled') {
      const { result } = r.value
      reviewerResults[role] = { issues: result.issues, score: result.score }
      reviewStatus[role] = result.method === 'rule-fallback' ? 'fallback' : 'success'
      logger.info('审查员结果', {
        role,
        taskId,
        method: result.method,
        issues: result.issues.length,
        latencyMs: agentLatency.reviewers[role]
      })
    } else {
      // 审查员彻底失败（重试耗尽且规则引擎也失败）
      reviewerResults[role] = { issues: [], score: 0 }
      reviewStatus[role] = 'failed'
      const errorMsg = r.reason?.message || String(r.reason)
      logger.error('审查员彻底失败', { role, taskId, error: errorMsg })
      onEvent({ type: 'error', role, message: `${role} 审查失败: ${errorMsg}` })
    }
  })

  const t3 = performance.now()

  // ═══════════════════════════════════════════════════════
  // Step 4: Post-review aggregation (NEW — structured LLM)
  // ═══════════════════════════════════════════════════════
  onEvent({ type: 'orchestrator_summary', message: '正在汇总审查结果并生成报告...' })

  // 先做去重和聚合
  const dimResultsForCollection = Object.entries(reviewerResults).map(([dim, r]) => ({
    dimension: dim,
    issues: r.issues,
    score: r.score
  }))

  // 使用 collectResults 工具做聚合
  const collectTool = toolRegistry.get('collectResults')
  let collectionResult = ''
  if (collectTool) {
    collectionResult = await collectTool.execute({
      dimensionResults: JSON.stringify(dimResultsForCollection)
    })
  }

  // 解析聚合结果
  let mergedIssues: Issue[]
  let overallScore: number
  try {
    const parsed = JSON.parse(collectionResult)
    mergedIssues = (parsed.mergedIssues || []).map((i: Record<string, unknown>) => ({
      line: i.line as number,
      severity: i.severity as 'critical' | 'warning' | 'suggestion',
      category: i.category as string,
      message: i.message as string,
      suggestion: i.suggestion as string
    }))
    overallScore = parsed.overallScore || 0
  } catch {
    // 回退到简单合并
    mergedIssues = Object.values(reviewerResults).flatMap(r => r.issues)
    const scores = Object.values(reviewerResults).map(r => r.score)
    overallScore =
      scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
  }

  // 使用 generateReport 工具生成最终报告
  const reportTool = toolRegistry.get('generateReport')
  let finalReport: ReportContent
  if (reportTool) {
    const reportResult = await reportTool.execute({
      collectionResult,
      codeStats: JSON.stringify(codeStats),
      language
    })
    try {
      const parsed = JSON.parse(reportResult)
      finalReport = {
        issues: mergedIssues,
        score: parsed.score || overallScore,
        agentResults: reviewerResults as unknown as Record<string, AgentResult>,
        reviewStatus
      }
    } catch {
      finalReport = {
        issues: mergedIssues,
        score: overallScore,
        agentResults: reviewerResults as unknown as Record<string, AgentResult>,
        reviewStatus
      }
    }
  } else {
    finalReport = {
      issues: mergedIssues,
      score: overallScore,
      agentResults: reviewerResults as unknown as Record<string, AgentResult>,
      reviewStatus
    }
  }

  // REQ-10：报告落库前对问题描述与建议做密钥脱敏，并记录注入检测结论
  finalReport.issues = finalReport.issues.map(issue => ({
    ...issue,
    message: redactSecrets(issue.message),
    suggestion: redactSecrets(issue.suggestion)
  }))
  // REQ-14：按 severityThreshold 过滤、按 maxIssues 截断
  finalReport.issues = applyReviewConfig(finalReport.issues, reviewConfig)

  if (injectionFindings.length > 0) {
    finalReport.security = {
      injectionSuspected: true,
      findings: injectionFindings.map(item => ({
        line: item.line,
        pattern: item.pattern,
        excerpt: redactSecrets(item.excerpt)
      }))
    }
  }

  // REQ-11：汇总 ReAct 治理统计，只有真正发生工具调用、熔断或预算降级时才写入报告
  const governance = {
    loopBreaks: Object.values(guards).reduce((sum, item) => sum + item.loopBreaks, 0),
    toolCalls: Object.values(guards).reduce((sum, item) => sum + item.toolCalls, 0),
    budgetExceeded
  }
  if (governance.loopBreaks > 0 || governance.toolCalls > 0 || governance.budgetExceeded) {
    finalReport.governance = governance
  }

  const t4 = performance.now()
  agentLatency.reportGeneration = Math.round(t4 - t3)
  agentLatency.total = Math.round(t4 - t0)

  logger.info('审查任务完成（延迟统计）', {
    taskId,
    preScanMs: agentLatency.preScan,
    orchestrationMs: agentLatency.orchestration,
    reviewersMs: agentLatency.reviewers,
    reportGenerationMs: agentLatency.reportGeneration,
    totalMs: agentLatency.total
  })

  onEvent({ type: 'report_ready', report: finalReport })
  onEvent({ type: 'task_completed' })

  return finalReport
}

export { runReviewTask, runRuleOnlyReview }
export type { ReviewEvent }
