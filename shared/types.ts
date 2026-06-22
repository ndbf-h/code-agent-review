// ── Task statuses ──
type TaskStatus = 'pending' | 'orchestrating' | 'reviewing' | 'summarizing' | 'completed' | 'failed'

// ── Agent roles ──
type AgentRole = 'orchestrator' | 'security' | 'performance' | 'style' | 'logic'

// ── Agent statuses ──
type AgentStatus = 'idle' | 'thinking' | 'calling_tool' | 'done' | 'error'

// ── Message types ──
type MessageType = 'user_input' | 'agent_thought' | 'tool_call' | 'tool_result' | 'final_answer'

// ── Issue severity ──
type Severity = 'critical' | 'warning' | 'suggestion'

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

interface ReportContent {
  issues: Issue[]
  agentResults: Record<string, AgentResult>
}

interface Task {
  id: string
  title: string
  codeSnippet: string
  language: string
  status: TaskStatus
  createdAt: string
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
  TaskStatus, AgentRole, AgentStatus, MessageType, Severity,
  Issue, AgentResult, ReportContent,
  Task, Agent, Message, ToolCall, Report
}
