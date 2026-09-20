// ── Task statuses ──
type TaskStatus =
  'pending' | 'orchestrating' | 'reviewing' | 'summarizing' | 'completed' | 'failed' | 'cancelled'

// ── Agent roles ──
type AgentRole = 'orchestrator' | 'security' | 'performance' | 'style' | 'logic'

// ── Agent statuses ──
type AgentStatus = 'idle' | 'thinking' | 'calling_tool' | 'done' | 'error'

// ── Message types ──
type MessageType = 'user_input' | 'agent_thought' | 'tool_call' | 'tool_result' | 'final_answer'

// ── Issue severity ──
type Severity = 'critical' | 'warning' | 'suggestion'

// ── 审查维度与请求级配置（REQ-14） ──
type ReviewDimension = 'security' | 'performance' | 'style' | 'logic'

interface ReviewConfig {
  /** 追加给审查员的自定义要求（不超过 2000 字符） */
  instructions?: string
  /** 只运行指定维度，缺省表示四个维度全跑 */
  dimensions?: ReviewDimension[]
  /** 过滤掉严重度低于该值的问题 */
  severityThreshold?: Severity
  /** 问题数量上限：先按严重度、再按行号排序后截断 */
  maxIssues?: number
}

/** 任务来源（REQ-15：GitHub Webhook 等；粘贴代码创建的任务为空） */
interface TaskSource {
  provider: 'github'
  repo: string
  prNumber: number
  headSha?: string
}

interface Issue {
  line: number
  severity: Severity
  category: string
  message: string
  suggestion: string
}

interface AgentResult {
  issues: Issue[]
  score: number
}

/** 疑似 prompt injection 的检测记录（REQ-10） */
interface InjectionFinding {
  /** 命中行号（从 1 开始） */
  line: number
  /** 命中的规则名 */
  pattern: string
  /** 命中片段（已截断） */
  excerpt: string
}

/** 报告的输入安全信息（REQ-10） */
interface ReportSecurity {
  /** 是否检测到疑似注入内容 */
  injectionSuspected: boolean
  /** 检测到的疑似片段 */
  findings: InjectionFinding[]
}

/** ReAct 治理统计（REQ-11） */
interface ReportGovernance {
  /** 被熔断的重复工具调用次数 */
  loopBreaks: number
  /** 累计工具调用次数 */
  toolCalls: number
  /** 是否因超出 token 预算而提前降级 */
  budgetExceeded: boolean
}

interface ReportContent {
  issues: Issue[]
  score: number
  agentResults: Record<string, AgentResult>
  reviewStatus?: Record<string, 'success' | 'fallback' | 'failed'>
  /** 输入安全信息，仅在检测到疑似注入时写入 */
  security?: ReportSecurity
  /** ReAct 治理统计，仅在产生熔断/预算事件时写入 */
  governance?: ReportGovernance
}

interface Task {
  id: string
  title: string
  codeSnippet: string
  language: string
  status: TaskStatus
  createdAt: string
  scopeId: string
  /** 已失败的执行次数（仅确认失败转入重试时递增，worker 崩溃回收不计数） */
  attemptCount?: number
  /** worker 执行心跳时间戳（ISO），用于崩溃检测 */
  heartbeatAt?: string | null
  /** 请求级审查配置（REQ-14） */
  reviewConfig?: ReviewConfig
  /** 任务来源（REQ-15） */
  source?: TaskSource
}

interface Agent {
  id: string
  taskId: string
  role: AgentRole
  status: AgentStatus
  modelName: string
  createdAt: string
}

interface Message {
  id: string
  taskId: string
  agentId: string | null
  role: 'user' | 'agent' | 'system'
  content: string
  type: MessageType
  createdAt: string
}

interface ToolCall {
  id: string
  agentId: string
  messageId: string
  toolName: string
  input: string
  output: string
  createdAt: string
}

interface Report {
  id: string
  taskId: string
  content: string
  score: number
  createdAt: string
}

export type {
  TaskStatus,
  AgentRole,
  AgentStatus,
  MessageType,
  Severity,
  ReviewDimension,
  ReviewConfig,
  TaskSource,
  Issue,
  AgentResult,
  ReportContent,
  Task,
  Agent,
  Message,
  ToolCall,
  Report
}
