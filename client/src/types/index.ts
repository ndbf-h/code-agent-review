/**
 * 前端类型入口（REQ-12 / CONTRIBUTING §九）。
 *
 * 与服务端共享的类型一律从 `shared/types.ts` 重导出，保持单一真源；
 * 本文件只保留前端独有的类型（ChatMessage、TaskItem 等），
 * 以及 `ReviewReport`（即 shared 的 `ReportContent`）在前端的惯用名。
 */
import type { AgentRole, ReportContent, TaskStatus } from '../../../shared/types'

/** 报告内容在前端的惯用名（与 shared 的 ReportContent 为同一类型） */
type ReviewReport = ReportContent

export type {
  TaskStatus,
  AgentRole,
  Severity,
  ReviewDimension,
  ReviewConfig,
  Issue,
  AgentResult,
  InjectionFinding,
  ReportSecurity,
  ReportGovernance,
  ReportContent,
  ReviewerStatus
} from '../../../shared/types'

/** 报告内容在前端的惯用名（与 shared 的 ReportContent 为同一类型） */
export type { ReportContent as ReviewReport } from '../../../shared/types'

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

export type { ChatMessage, TaskItem, TaskListResponse, FixChange, FixResult }
