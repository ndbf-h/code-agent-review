import { getDb, saveDb } from './connection'
import type { Task, Agent, Message, ToolCall, Report } from '../../../shared/types'

// ── Helpers ──

async function execSelect(_sql: string): Promise<Record<string, unknown>[]> {
  // sql.js exec for parameterized queries — reserved for future use
  return []
}

// ── Tasks ──

async function insertTask(task: Task): Promise<void> {
  const db = await getDb()
  db.run(
    'INSERT INTO tasks (id, title, code_snippet, language, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [task.id, task.title, task.codeSnippet, task.language, task.status, task.createdAt]
  )
  saveDb()
}

async function updateTaskStatus(id: string, status: string): Promise<void> {
  const db = await getDb()
  db.run('UPDATE tasks SET status = ? WHERE id = ?', [status, id])
  saveDb()
}

async function getTask(id: string): Promise<Task | null> {
  const rows = await execSelect('SELECT * FROM tasks WHERE id = ?')
  // sql.js exec doesn't support parameterized queries directly, use manual approach
  const db = await getDb()
  const stmt = db.prepare('SELECT * FROM tasks WHERE id = ?')
  stmt.bind([id])
  if (!stmt.step()) return null
  const row = stmt.getAsObject()
  stmt.free()
  return {
    id: row.id as string,
    title: row.title as string,
    codeSnippet: row.code_snippet as string,
    language: row.language as string,
    status: row.status as Task['status'],
    createdAt: row.created_at as string
  }
}

// ── Agents ──

async function insertAgent(agent: Agent): Promise<void> {
  const db = await getDb()
  db.run(
    'INSERT INTO agents (id, task_id, role, status, model_name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [agent.id, agent.taskId, agent.role, agent.status, agent.modelName, agent.createdAt]
  )
  saveDb()
}

async function getAgentsByTask(taskId: string): Promise<Agent[]> {
  const db = await getDb()
  const stmt = db.prepare('SELECT * FROM agents WHERE task_id = ?')
  stmt.bind([taskId])
  const agents: Agent[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject()
    agents.push({
      id: row.id as string,
      taskId: row.task_id as string,
      role: row.role as Agent['role'],
      status: row.status as Agent['status'],
      modelName: row.model_name as string,
      createdAt: row.created_at as string
    })
  }
  stmt.free()
  return agents
}

// ── Messages ──

async function insertMessage(message: Message): Promise<void> {
  const db = await getDb()
  db.run(
    'INSERT INTO messages (id, task_id, agent_id, role, content, type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [message.id, message.taskId, message.agentId, message.role, message.content, message.type, message.createdAt]
  )
  saveDb()
}

async function getMessagesByTask(taskId: string): Promise<Message[]> {
  const db = await getDb()
  const stmt = db.prepare('SELECT * FROM messages WHERE task_id = ? ORDER BY created_at ASC')
  stmt.bind([taskId])
  const messages: Message[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject()
    messages.push({
      id: row.id as string,
      taskId: row.task_id as string,
      agentId: row.agent_id as string | null,
      role: row.role as Message['role'],
      content: row.content as string,
      type: row.type as Message['type'],
      createdAt: row.created_at as string
    })
  }
  stmt.free()
  return messages
}

// ── Tool Calls ──

async function insertToolCall(toolCall: ToolCall): Promise<void> {
  const db = await getDb()
  db.run(
    'INSERT INTO tool_calls (id, agent_id, message_id, tool_name, input, output, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [toolCall.id, toolCall.agentId, toolCall.messageId, toolCall.toolName, toolCall.input, toolCall.output, toolCall.createdAt]
  )
  saveDb()
}

// ── Reports ──

async function insertReport(report: Report): Promise<void> {
  const db = await getDb()
  db.run(
    'INSERT OR REPLACE INTO reports (id, task_id, content, score, created_at) VALUES (?, ?, ?, ?, ?)',
    [report.id, report.taskId, report.content, report.score, report.createdAt]
  )
  saveDb()
}

async function getReportByTask(taskId: string): Promise<Report | null> {
  const db = await getDb()
  const stmt = db.prepare('SELECT * FROM reports WHERE task_id = ?')
  stmt.bind([taskId])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = stmt.getAsObject()
  stmt.free()
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    content: row.content as string,
    score: row.score as number,
    createdAt: row.created_at as string
  }
}

export {
  insertTask, updateTaskStatus, getTask,
  insertAgent, getAgentsByTask,
  insertMessage, getMessagesByTask,
  insertToolCall,
  insertReport, getReportByTask
}
