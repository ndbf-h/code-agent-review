import { v4 as uuidv4 } from 'uuid'
import type { Task, Agent, Message, ReportContent, AgentRole } from '../../../shared/types'
import { insertTask, updateTaskStatus, getTask, insertAgent, insertMessage, insertReport, getReportByTask, getMessagesByTask, getAgentsByTask } from '../db/queries'

async function createTask(code: string, language: string, title?: string): Promise<Task> {
  const task: Task = {
    id: uuidv4(),
    title: title || `Code Review - ${new Date().toLocaleString()}`,
    codeSnippet: code,
    language,
    status: 'pending',
    createdAt: new Date().toISOString()
  }

  insertTask(task)
  return task
}

async function createAgentsForTask(taskId: string): Promise<void> {
  const roles: AgentRole[] = ['orchestrator', 'security', 'performance', 'style', 'logic']
  const modelName = process.env.LLM_MODEL || 'claude-sonnet-4-6'

  for (const role of roles) {
    const agent: Agent = {
      id: `${role}-${taskId}`,
      taskId,
      role,
      status: 'idle',
      modelName,
      createdAt: new Date().toISOString()
    }
    insertAgent(agent)
  }
}

async function saveReport(taskId: string, reportContent: ReportContent, score: number): Promise<void> {
  const report = {
    id: `report-${taskId}`,
    taskId,
    content: JSON.stringify(reportContent),
    score,
    createdAt: new Date().toISOString()
  }
  insertReport(report)
}

async function getTaskDetail(taskId: string): Promise<{
  task: Task | null
  agents: Agent[]
  messages: Message[]
  report: { content: ReportContent; score: number } | null
}> {
  const task = getTask(taskId)
  const agents = getAgentsByTask(taskId)
  const messages = getMessagesByTask(taskId)
  const report = getReportByTask(taskId)

  let reportData = null
  if (report) {
    reportData = {
      content: JSON.parse(report.content) as ReportContent,
      score: report.score
    }
  }

  return { task, agents, messages, report: reportData }
}

export { createTask, createAgentsForTask, saveReport, getTaskDetail, updateTaskStatus }
