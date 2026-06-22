type TaskStatus = 'pending' | 'orchestrating' | 'reviewing' | 'summarizing' | 'completed' | 'failed'
type AgentRole = 'orchestrator' | 'security' | 'performance' | 'style' | 'logic'
type Severity = 'critical' | 'warning' | 'suggestion'

interface Issue {
  line: number
  severity: Severity
  category: string
  message: string
  suggestion: string
}

interface ReviewReport {
  issues: Issue[]
  score: number
  agentResults: Record<string, { issues: Issue[]; score: number }>
}

interface ChatMessage {
  id: string
  role: AgentRole | 'user' | 'system'
  content: string
  type: 'user_input' | 'agent_thought' | 'tool_call' | 'tool_result' | 'final_answer' | 'report'
  timestamp: string
  toolName?: string
  report?: ReviewReport
}

export type { TaskStatus, AgentRole, Severity, Issue, ReviewReport, ChatMessage }
