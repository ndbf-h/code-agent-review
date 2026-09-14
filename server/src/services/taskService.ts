import { v4 as uuidv4 } from 'uuid'
import { getConfig } from '../config'
import type { Task, Agent, Message, ReportContent, AgentRole } from '../../../shared/types'
import {
  insertTask,
  updateTaskStatus,
  getTask,
  insertAgent,
  insertReport,
  getReportByTask,
  getMessagesByTask,
  getAgentsByTask
} from '../db/queries'

async function createTask(
  code: string,
  language: string,
  title?: string,
  scopeId?: string
): Promise<Task> {
  const id = uuidv4()
  const task: Task = {
    id,
    title: title || `Code Review - ${new Date().toLocaleString()}`,
    codeSnippet: code,
    language,
    scopeId: scopeId || id,
    status: 'pending',
    createdAt: new Date().toISOString()
  }

  await insertTask(task)
  return task
}

async function createAgentsForTask(taskId: string): Promise<void> {
  const roles: AgentRole[] = ['orchestrator', 'security', 'performance', 'style', 'logic']
  const modelName = getConfig().llm.model

  for (const role of roles) {
    const agent: Agent = {
      id: `${role}-${taskId}`,
      taskId,
      role,
      status: 'idle',
      modelName,
      createdAt: new Date().toISOString()
    }
    await insertAgent(agent)
  }
}

async function saveReport(
  taskId: string,
  reportContent: ReportContent,
  score: number
): Promise<void> {
  const report = {
    id: `report-${taskId}`,
    taskId,
    content: JSON.stringify(reportContent),
    score,
    createdAt: new Date().toISOString()
  }
  await insertReport(report)
}

async function getTaskDetail(taskId: string): Promise<{
  task: Task | null
  agents: Agent[]
  messages: Message[]
  report: { content: ReportContent; score: number } | null
}> {
  const task = await getTask(taskId)
  const agents = await getAgentsByTask(taskId)
  const messages = await getMessagesByTask(taskId)
  const report = await getReportByTask(taskId)

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
