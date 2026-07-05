import { getDb } from './connection'
import type { Task, Agent, Message, ToolCall, Report } from '../../../shared/types'

// ── Tasks ──

function insertTask(task: Task): void {
  const db = getDb()
  db.prepare(
    'INSERT INTO tasks (id, title, code_snippet, language, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(task.id, task.title, task.codeSnippet, task.language, task.status, task.createdAt)
}

function updateTaskStatus(id: string, status: string): void {
  const db = getDb()
  db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(id, status)
}

function getTask(id: string): Task | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) return null
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

function insertAgent(agent: Agent): void {
  const db = getDb()
  db.prepare(
    'INSERT INTO agents (id, task_id, role, status, model_name, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(agent.id, agent.taskId, agent.role, agent.status, agent.modelName, agent.createdAt)
}

function getAgentsByTask(taskId: string): Agent[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM agents WHERE task_id = ?').all(taskId) as Record<string, unknown>[]
  return rows.map(row => ({
    id: row.id as string,
    taskId: row.task_id as string,
    role: row.role as Agent['role'],
    status: row.status as Agent['status'],
    modelName: row.model_name as string,
    createdAt: row.created_at as string
  }))
}

// ── Messages ──

function insertMessage(message: Message): void {
  const db = getDb()
  db.prepare(
    'INSERT INTO messages (id, task_id, agent_id, role, content, type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(message.id, message.taskId, message.agentId, message.role, message.content, message.type, message.createdAt)
}

function getMessagesByTask(taskId: string): Message[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM messages WHERE task_id = ? ORDER BY created_at ASC').all(taskId) as Record<string, unknown>[]
  return rows.map(row => ({
    id: row.id as string,
    taskId: row.task_id as string,
    agentId: row.agent_id as string | null,
    role: row.role as Message['role'],
    content: row.content as string,
    type: row.type as Message['type'],
    createdAt: row.created_at as string
  }))
}

// ── Tool Calls ──

function insertToolCall(toolCall: ToolCall): void {
  const db = getDb()
  db.prepare(
    'INSERT INTO tool_calls (id, agent_id, message_id, tool_name, input, output, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(toolCall.id, toolCall.agentId, toolCall.messageId, toolCall.toolName, toolCall.input, toolCall.output, toolCall.createdAt)
}

// ── Reports ──

function insertReport(report: Report): void {
  const db = getDb()
  db.prepare(
    'INSERT OR REPLACE INTO reports (id, task_id, content, score, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(report.id, report.taskId, report.content, report.score, report.createdAt)
}

function getReportByTask(taskId: string): Report | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM reports WHERE task_id = ?').get(taskId) as Record<string, unknown> | undefined
  if (!row) return null
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
