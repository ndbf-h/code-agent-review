type TaskStatus =
  'pending' | 'orchestrating' | 'reviewing' | 'summarizing' | 'completed' | 'failed' | 'cancelled'
type AgentRole = 'orchestrator' | 'security' | 'performance' | 'style' | 'logic'
type Severity = 'critical' | 'warning' | 'suggestion'

interface Issue {
  line: number
  severity: Severity
  category: string
  message: string
  suggestion: string
}

/** 疑似 prompt injection 检测记录（与服务端 shared/types.ts 保持一致） */
interface ReportInjectionFinding {
  line: number
  pattern: string
  excerpt: string
}

/** 报告输入安全信息 */
interface ReportSecurity {
  injectionSuspected: boolean
  findings: ReportInjectionFinding[]
}

/** ReAct 治理统计 */
interface ReportGovernance {
  loopBreaks: number
  toolCalls: number
  budgetExceeded: boolean
}

interface ReviewReport {
  issues: Issue[]
  score: number
  agentResults: Record<string, { issues: Issue[]; score: number }>
  reviewStatus?: Record<string, 'success' | 'fallback' | 'failed'>
  security?: ReportSecurity
  governance?: ReportGovernance
}

interface ChatMessage {
  id: string
  role: AgentRole | 'assistant' | 'user' | 'system'
  content: string
  type: 'user_input' | 'agent_thought' | 'tool_call' | 'tool_result' | 'final_answer' | 'report'
  timestamp: string
  toolName?: string
  report?: ReviewReport
}

interface TaskItem {
  id: string
  title: string
  codeSnippet: string
  language: string
  status: TaskStatus
  createdAt: string
  score: number | null
}

interface TaskListResponse {
  tasks: TaskItem[]
  total: number
  limit: number
  offset: number
}

interface FixChange {
  line: number
  description: string
  before: string
  after: string
}

interface FixResult {
  originalCode: string
  fixedCode: string
  changes: FixChange[]
}

export type {
  TaskStatus,
  AgentRole,
  Severity,
  Issue,
  ReviewReport,
  ChatMessage,
  TaskItem,
  TaskListResponse,
  FixChange,
  FixResult
}
