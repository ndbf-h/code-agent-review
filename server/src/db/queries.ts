import { getDb, withTransaction } from './connection'
import type { Task, Agent, Message, ToolCall, Report } from '../../../shared/types'

export interface ConversationMessage {
  id: string
  taskId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface CodeVersion {
  id: string
  taskId: string
  code: string
  language: string
  source: string
  summary: string
  reviewTaskId?: string
  createdAt: string
}

export interface KnowledgeChunk {
  id: string
  documentId: string
  scopeId: string
  content: string
  source: string
  language: string
  dimension: string
  createdAt: string
}

// ── Tasks ──

export async function insertTask(task: Task): Promise<void> {
  const db = getDb()
  await db.query(
    'INSERT INTO tasks (id, title, code_snippet, language, scope_id, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [task.id, task.title, task.codeSnippet, task.language, task.scopeId, task.status, task.createdAt]
  )
}

export async function updateTaskStatus(id: string, status: string): Promise<void> {
  const db = getDb()
  await db.query('UPDATE tasks SET status = $1 WHERE id = $2', [status, id])
}

export async function getTask(id: string): Promise<Task | null> {
  const db = getDb()
  const { rows } = await db.query('SELECT * FROM tasks WHERE id = $1', [id])
  const row = rows[0] as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: row.id as string,
    title: row.title as string,
    codeSnippet: row.code_snippet as string,
    language: row.language as string,
    scopeId: (row.scope_id as string) || (row.id as string),
    status: row.status as Task['status'],
    createdAt: row.created_at as string,
    attemptCount: row.attempt_count !== undefined ? Number(row.attempt_count) : 0,
    heartbeatAt: (row.heartbeat_at as string | null) ?? null
  }
}

// ── Agents ──

export async function insertAgent(agent: Agent): Promise<void> {
  const db = getDb()
  await db.query(
    'INSERT INTO agents (id, task_id, role, status, model_name, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [agent.id, agent.taskId, agent.role, agent.status, agent.modelName, agent.createdAt]
  )
}

export async function getAgentsByTask(taskId: string): Promise<Agent[]> {
  const db = getDb()
  const { rows } = await db.query('SELECT * FROM agents WHERE task_id = $1', [taskId])
  return (rows as Record<string, unknown>[]).map(row => ({
    id: row.id as string,
    taskId: row.task_id as string,
    role: row.role as Agent['role'],
    status: row.status as Agent['status'],
    modelName: row.model_name as string,
    createdAt: row.created_at as string
  }))
}

// ── Messages ──

export async function insertMessage(message: Message): Promise<void> {
  const db = getDb()
  await db.query(
    'INSERT INTO messages (id, task_id, agent_id, role, content, type, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [message.id, message.taskId, message.agentId, message.role, message.content, message.type, message.createdAt]
  )
}

export async function getMessagesByTask(taskId: string): Promise<Message[]> {
  const db = getDb()
  const { rows } = await db.query('SELECT * FROM messages WHERE task_id = $1 ORDER BY created_at ASC', [taskId])
  return (rows as Record<string, unknown>[]).map(row => ({
    id: row.id as string,
    taskId: row.task_id as string,
    agentId: row.agent_id as string | null,
    role: row.role as Message['role'],
    content: row.content as string,
    type: row.type as Message['type'],
    createdAt: row.created_at as string
  }))
}

export async function insertConversationMessage(message: ConversationMessage): Promise<void> {
  const db = getDb()
  await db.query(
    'INSERT INTO conversation_messages (id, task_id, role, content, created_at) VALUES ($1, $2, $3, $4, $5)',
    [message.id, message.taskId, message.role, message.content, message.createdAt]
  )
}

export async function getConversationMessages(taskId: string, limit = 12): Promise<ConversationMessage[]> {
  const db = getDb()
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT * FROM conversation_messages WHERE task_id = $1
       ORDER BY created_at DESC LIMIT $2
     ) recent ORDER BY created_at ASC`,
    [taskId, limit]
  )
  return (rows as Record<string, unknown>[]).map(row => ({
    id: row.id as string,
    taskId: row.task_id as string,
    role: row.role as ConversationMessage['role'],
    content: row.content as string,
    createdAt: row.created_at as string
  }))
}

export async function insertCodeVersion(version: CodeVersion): Promise<void> {
  const db = getDb()
  await db.query(
    'INSERT INTO code_versions (id, task_id, code, language, source, summary, review_task_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [version.id, version.taskId, version.code, version.language, version.source, version.summary, version.reviewTaskId || null, version.createdAt]
  )
}

export async function linkCodeVersionToReview(versionId: string, reviewTaskId: string): Promise<void> {
  const db = getDb()
  await db.query('UPDATE code_versions SET review_task_id = $1 WHERE id = $2', [reviewTaskId, versionId])
}

export async function insertKnowledgeDocument(document: {
  id: string
  scopeId: string
  fileName: string
  language: string
  dimension: string
  content: string
  createdAt: string
}): Promise<void> {
  const db = getDb()
  await db.query(
    'INSERT INTO knowledge_documents (id, scope_id, file_name, language, dimension, content, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [document.id, document.scopeId, document.fileName, document.language, document.dimension, document.content, document.createdAt]
  )
}

export async function insertKnowledgeChunk(chunk: KnowledgeChunk): Promise<void> {
  const db = getDb()
  await db.query(
    'INSERT INTO knowledge_chunks (id, document_id, scope_id, content, source, language, dimension, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [chunk.id, chunk.documentId, chunk.scopeId, chunk.content, chunk.source, chunk.language, chunk.dimension, chunk.createdAt]
  )
}

export async function getKnowledgeChunks(scopeId: string): Promise<KnowledgeChunk[]> {
  const db = getDb()
  const { rows } = await db.query('SELECT * FROM knowledge_chunks WHERE scope_id = $1 ORDER BY created_at ASC', [scopeId])
  return (rows as Record<string, unknown>[]).map(row => ({
    id: row.id as string,
    documentId: row.document_id as string,
    scopeId: row.scope_id as string,
    content: row.content as string,
    source: row.source as string,
    language: row.language as string,
    dimension: row.dimension as string,
    createdAt: row.created_at as string
  }))
}

// ── Tool Calls ──

export async function insertToolCall(toolCall: ToolCall): Promise<void> {
  const db = getDb()
  await db.query(
    'INSERT INTO tool_calls (id, agent_id, message_id, tool_name, input, output, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [toolCall.id, toolCall.agentId, toolCall.messageId, toolCall.toolName, toolCall.input, toolCall.output, toolCall.createdAt]
  )
}

// ── Reports ──

export async function insertReport(report: Report): Promise<void> {
  const db = getDb()
  await db.query(
    'INSERT INTO reports (id, task_id, content, score, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, score = EXCLUDED.score',
    [report.id, report.taskId, report.content, report.score, report.createdAt]
  )
}

export async function getReportByTask(taskId: string): Promise<Report | null> {
  const db = getDb()
  const { rows } = await db.query('SELECT * FROM reports WHERE task_id = $1', [taskId])
  const row = rows[0] as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    content: row.content as string,
    score: Number(row.score),
    createdAt: row.created_at as string
  }
}

  const VALID_TASK_STATUSES: Task['status'][] = ['pending', 'orchestrating', 'reviewing', 'summarizing', 'completed', 'failed']

  function isTaskStatus(value: unknown): value is Task['status'] {
    return typeof value === 'string' && (VALID_TASK_STATUSES as string[]).includes(value)
  }

  export async function listTasks(limit = 20, offset = 0, status?: Task['status']): Promise<Task[]> {
    const db = getDb()
    const params: unknown[] = []
    let whereClause = ''
    if (isTaskStatus(status)) {
      params.push(status)
      whereClause = ' WHERE t.status = $1'
    }
    params.push(limit, offset)
    const { rows } = await db.query(
      `SELECT t.*, r.score as report_score FROM tasks t LEFT JOIN reports r ON t.id = r.task_id${whereClause} ORDER BY t.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    return (rows as Record<string, unknown>[]).map(row => ({
      id: row.id as string,
      title: row.title as string,
      codeSnippet: row.code_snippet as string,
      language: row.language as string,
      scopeId: (row.scope_id as string) || (row.id as string),
      status: row.status as Task['status'],
      createdAt: row.created_at as string,
      score: (row.report_score as number) ?? null
    }))
  }

  export async function countTasks(status?: Task['status']): Promise<number> {
    const db = getDb()
    const params: unknown[] = []
    let whereClause = ''
    if (isTaskStatus(status)) {
      params.push(status)
      whereClause = ' WHERE status = $1'
    }
    const { rows } = await db.query(`SELECT COUNT(*) as cnt FROM tasks${whereClause}`, params)
    const row = rows[0] as { cnt: string }
    return parseInt(row.cnt, 10)
  }

// ── Task Events（事件日志：回放与跨进程扇出的数据源）──

export interface TaskEventRow {
  seq: number
  taskId: string
  type: string
  payload: Record<string, unknown>
  createdAt: string
}

function mapTaskEventRow(row: Record<string, unknown>): TaskEventRow {
  return {
    seq: Number(row.id),
    taskId: row.task_id as string,
    type: row.type as string,
    payload: (row.payload && typeof row.payload === 'object'
      ? row.payload
      : JSON.parse(String(row.payload))) as Record<string, unknown>,
    createdAt: row.created_at as string
  }
}

export async function insertTaskEvent(
  taskId: string,
  type: string,
  payload: Record<string, unknown>
): Promise<number> {
  const db = getDb()
  const { rows } = await db.query(
    'INSERT INTO task_events (task_id, type, payload, created_at) VALUES ($1, $2, $3, $4) RETURNING id',
    [taskId, type, JSON.stringify(payload), new Date().toISOString()]
  )
  return Number((rows[0] as { id: string }).id)
}

export async function getTaskEventsAfter(taskId: string, afterSeq: number, limit = 500): Promise<TaskEventRow[]> {
  const db = getDb()
  const { rows } = await db.query(
    'SELECT id, task_id, type, payload, created_at FROM task_events WHERE task_id = $1 AND id > $2 ORDER BY id ASC LIMIT $3',
    [taskId, afterSeq, limit]
  )
  return (rows as Record<string, unknown>[]).map(mapTaskEventRow)
}

export async function getTaskEventBySeq(seq: number): Promise<TaskEventRow | null> {
  const db = getDb()
  const { rows } = await db.query(
    'SELECT id, task_id, type, payload, created_at FROM task_events WHERE id = $1',
    [seq]
  )
  const row = rows[0] as Record<string, unknown> | undefined
  return row ? mapTaskEventRow(row) : null
}

// ── 任务抢占与生命周期（RabbitMQ 消费的幂等基础）──

export type ClaimDecision = 'claim' | 'running' | 'terminal'

/**
 * 消息消费前的抢占决策（纯函数，便于单测）。
 * DB 中会出现 pending / orchestrating / completed / failed / cancelled 状态。
 */
export function decideClaim(status: string | undefined): ClaimDecision {
  if (status === undefined) return 'terminal'
  if (status === 'pending') return 'claim'
  if (status === 'orchestrating') return 'running'
  return 'terminal'
}

/**
 * 取消任务（原子条件更新）：仅 pending/orchestrating 可取消，
 * 与终态写入（completed/failed）天然互斥，避免取消与完成的竞态覆盖。
 * 返回是否取消成功。
 */
export async function cancelTask(id: string): Promise<boolean> {
  const db = getDb()
  const { rowCount } = await db.query(
    "UPDATE tasks SET status = 'cancelled', heartbeat_at = NULL WHERE id = $1 AND status IN ('pending', 'orchestrating')",
    [id]
  )
  return (rowCount ?? 0) > 0
}

/**
 * 原子抢占任务：pending → orchestrating 并写入首个心跳。
 * 其他状态不抢占 —— running 说明别的 worker 正在执行（崩溃回收交给 sweeper），
 * terminal 说明是重复投递，幂等吸收即可。
 */
export async function claimTaskForRun(taskId: string): Promise<{ claimed: boolean; decision: ClaimDecision }> {
  return withTransaction(async client => {
    const { rows } = await client.query('SELECT status FROM tasks WHERE id = $1 FOR UPDATE', [taskId])
    const status = (rows[0] as { status: string } | undefined)?.status
    const decision = decideClaim(status)
    if (decision === 'claim') {
      await client.query(
        "UPDATE tasks SET status = 'orchestrating', heartbeat_at = $1 WHERE id = $2",
        [new Date().toISOString(), taskId]
      )
    }
    return { claimed: decision === 'claim', decision }
  })
}

export async function touchTaskHeartbeat(taskId: string): Promise<void> {
  const db = getDb()
  await db.query('UPDATE tasks SET heartbeat_at = $1 WHERE id = $2', [new Date().toISOString(), taskId])
}

/** 确认失败后转入重试：回 pending 并消耗一次重试额度 */
export async function scheduleTaskRetry(taskId: string): Promise<number> {
  const db = getDb()
  const { rows } = await db.query(
    "UPDATE tasks SET status = 'pending', heartbeat_at = NULL, attempt_count = attempt_count + 1 WHERE id = $1 RETURNING attempt_count",
    [taskId]
  )
  return Number((rows[0] as { attempt_count: number } | undefined)?.attempt_count ?? 0)
}

/** 条件完成：仅 orchestrating 可置 completed，防止与用户取消竞态覆盖 */
export async function completeTask(taskId: string): Promise<boolean> {
  const db = getDb()
  const { rowCount } = await db.query(
    "UPDATE tasks SET status = 'completed', heartbeat_at = NULL WHERE id = $1 AND status = 'orchestrating'",
    [taskId]
  )
  return (rowCount ?? 0) > 0
}

export async function markTaskFailed(taskId: string): Promise<void> {
  const db = getDb()
  await db.query("UPDATE tasks SET status = 'failed', heartbeat_at = NULL WHERE id = $1", [taskId])
}

/** 重试前清理上一次运行的产物（messages/tool_calls 主键是随机 uuid，重跑会重复） */
export async function resetTaskArtifacts(taskId: string): Promise<void> {
  await withTransaction(async client => {
    await client.query(
      'DELETE FROM tool_calls WHERE agent_id IN (SELECT id FROM agents WHERE task_id = $1)',
      [taskId]
    )
    await client.query('DELETE FROM messages WHERE task_id = $1', [taskId])
    await client.query('DELETE FROM reports WHERE task_id = $1', [taskId])
    await client.query("UPDATE agents SET status = 'idle' WHERE task_id = $1", [taskId])
  })
}

/**
 * sweeper：把心跳超时的 orchestrating 任务原子地重置回 pending 并返回其 id。
 * heartbeat_at 为 NULL 的 orchestrating 任务（改造前的存量悬挂任务）一并回收。
 */
export async function findStaleRunningTasks(staleBeforeIso: string): Promise<string[]> {
  const db = getDb()
  const { rows } = await db.query(
    "UPDATE tasks SET status = 'pending', heartbeat_at = NULL WHERE status = 'orchestrating' AND (heartbeat_at IS NULL OR heartbeat_at < $1) RETURNING id",
    [staleBeforeIso]
  )
  return (rows as { id: string }[]).map(r => r.id)
}

/** sweeper：长时间 pending 的任务重新发布，补偿“落库成功但消息丢失”的窗口 */
export async function findLostPendingTasks(createdBeforeIso: string): Promise<string[]> {
  const db = getDb()
  const { rows } = await db.query(
    "SELECT id FROM tasks WHERE status = 'pending' AND created_at < $1",
    [createdBeforeIso]
  )
  return (rows as { id: string }[]).map(r => r.id)
}

// ── Task Metrics（worker 每次执行一行，/api/metrics 聚合）──

export interface TaskMetricInput {
  taskId: string
  attempt: number
  status: 'completed' | 'retried' | 'failed' | 'cancelled'
  model: string
  promptTokens: number
  completionTokens: number
  fallbackReviewers: number
  durationMs: number
  cacheHit?: boolean
  error?: string
}

export async function insertTaskMetric(metric: TaskMetricInput): Promise<void> {
  const db = getDb()
  await db.query(
    `INSERT INTO task_metrics (task_id, attempt, status, model, prompt_tokens, completion_tokens, fallback_reviewers, duration_ms, cache_hit, error, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [metric.taskId, metric.attempt, metric.status, metric.model, metric.promptTokens, metric.completionTokens,
      metric.fallbackReviewers, metric.durationMs, metric.cacheHit ? true : false, metric.error || null, new Date().toISOString()]
  )
}

export interface TaskMetricsAggregate {
  runs: number
  completed: number
  retried: number
  failed: number
  cancelled: number
  successRate: number
  promptTokens: number
  completionTokens: number
  fallbackRuns: number
  cacheHits: number
  avgDurationMs: number
  p99DurationMs: number
}

export async function aggregateTaskMetrics(sinceIso: string): Promise<TaskMetricsAggregate> {
  const db = getDb()
  const { rows } = await db.query(
    `SELECT
       COUNT(*)::int AS runs,
       COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
       COUNT(*) FILTER (WHERE status = 'retried')::int AS retried,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
       COALESCE(SUM(prompt_tokens), 0)::int AS prompt_tokens,
       COALESCE(SUM(completion_tokens), 0)::int AS completion_tokens,
       COUNT(*) FILTER (WHERE fallback_reviewers > 0)::int AS fallback_runs,
       COUNT(*) FILTER (WHERE cache_hit)::int AS cache_hits,
       COALESCE(AVG(duration_ms), 0)::int AS avg_duration,
       COALESCE(PERCENTILE_DISC(0.99) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS p99_duration
     FROM task_metrics WHERE created_at >= $1`,
    [sinceIso]
  )
  const row = rows[0] as Record<string, number>
  const runs = row.runs || 0
  const cancelled = row.cancelled || 0
  // 成功率剔除已取消的任务（用户主动放弃不算失败）
  const denominator = Math.max(runs - cancelled, 0)
  return {
    runs,
    completed: row.completed,
    retried: row.retried,
    failed: row.failed,
    cancelled,
    successRate: denominator > 0 ? (row.completed + row.retried) / denominator : 0,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    fallbackRuns: row.fallback_runs,
    cacheHits: row.cache_hits,
    avgDurationMs: row.avg_duration,
    p99DurationMs: row.p99_duration
  }
}

export async function recentTaskFailures(limit = 10): Promise<Array<{ taskId: string; status: string; error: string | null; createdAt: string }>> {
  const db = getDb()
  const { rows } = await db.query(
    `SELECT task_id, status, error, created_at FROM task_metrics WHERE status = 'failed' ORDER BY id DESC LIMIT $1`,
    [limit]
  )
  return (rows as Record<string, unknown>[]).map(row => ({
    taskId: row.task_id as string,
    status: row.status as string,
    error: (row.error as string | null) || null,
    createdAt: row.created_at as string
  }))
}

// ── 审查结果语义缓存（相同代码+语言+模型+prompt 版本直接复用报告）──

export interface ReviewCacheEntry {
  reportContent: string
  score: number
  model: string
}

export async function getReviewCache(codeHash: string): Promise<ReviewCacheEntry | null> {
  const db = getDb()
  const { rows } = await db.query(
    'SELECT report_content, score, model FROM review_cache WHERE code_hash = $1',
    [codeHash]
  )
  const row = rows[0] as Record<string, unknown> | undefined
  if (!row) return null
  return {
    reportContent: row.report_content as string,
    score: Number(row.score),
    model: row.model as string
  }
}

export async function saveReviewCache(entry: {
  codeHash: string
  reportContent: string
  score: number
  model: string
  promptVersion: string
}): Promise<void> {
  const db = getDb()
  await db.query(
    `INSERT INTO review_cache (code_hash, report_content, score, model, prompt_version, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (code_hash) DO UPDATE SET report_content = EXCLUDED.report_content, score = EXCLUDED.score, model = EXCLUDED.model, prompt_version = EXCLUDED.prompt_version`,
    [entry.codeHash, entry.reportContent, entry.score, entry.model, entry.promptVersion, new Date().toISOString()]
  )
}

export async function bumpReviewCacheHit(codeHash: string): Promise<void> {
  const db = getDb()
  await db.query('UPDATE review_cache SET hit_count = hit_count + 1 WHERE code_hash = $1', [codeHash])
}

export async function getReviewCacheStats(): Promise<{ entries: number; totalHits: number }> {
  const db = getDb()
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS entries, COALESCE(SUM(hit_count), 0)::int AS hits FROM review_cache'
  )
  const row = rows[0] as Record<string, number>
  return { entries: row.entries || 0, totalHits: row.hits || 0 }
}
