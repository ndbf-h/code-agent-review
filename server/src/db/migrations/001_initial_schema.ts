import { sqlMigration } from './types'

/**
 * 初始 schema：与迁移机制引入前 schema.ts 的全部语句等价，保持 IF NOT EXISTS 幂等。
 * 已存在的库首次运行只会补一条 schema_migrations 记录，不改变任何表结构。
 */
export const initialSchema = sqlMigration('001_initial_schema', [
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    code_snippet TEXT NOT NULL,
    language TEXT NOT NULL,
    scope_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  )`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scope_id TEXT NOT NULL DEFAULT ''`,
  `UPDATE tasks SET scope_id = id WHERE scope_id = '' OR scope_id IS NULL`,

  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    model_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    agent_id TEXT REFERENCES agents(id),
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id),
    message_id TEXT NOT NULL REFERENCES messages(id),
    tool_name TEXT NOT NULL,
    input TEXT NOT NULL,
    output TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
    content TEXT NOT NULL,
    score INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS conversation_messages (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_messages_task_created
    ON conversation_messages(task_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS code_versions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    code TEXT NOT NULL,
    language TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'assistant',
    summary TEXT NOT NULL DEFAULT '',
    review_task_id TEXT REFERENCES tasks(id),
    created_at TEXT NOT NULL
  )`,
  `ALTER TABLE code_versions ADD COLUMN IF NOT EXISTS review_task_id TEXT REFERENCES tasks(id)`,

  `CREATE TABLE IF NOT EXISTS knowledge_documents (
    id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT '',
    dimension TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    scope_id TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT '',
    dimension TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_scope ON knowledge_chunks(scope_id)`,

  // ── 任务队列支持 ──
  // attempt_count 记录已失败次数（决定是否还有重试额度），heartbeat_at 用于崩溃检测
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS heartbeat_at TEXT`,

  // 事件日志：worker 落库，API 实例经 LISTEN/NOTIFY 实时扇出 + SSE 断线按 seq 回放
  `CREATE TABLE IF NOT EXISTS task_events (
    id BIGSERIAL PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id, id)`,

  // 落库即通知；PG 无 CREATE TRIGGER IF NOT EXISTS，用 DROP+CREATE 保证幂等
  `CREATE OR REPLACE FUNCTION notify_task_event() RETURNS trigger AS $$
  BEGIN
    PERFORM pg_notify('task_events', json_build_object('taskId', NEW.task_id, 'seq', NEW.id)::text);
    RETURN NEW;
  END
  $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS trg_task_events_notify ON task_events`,
  `CREATE TRIGGER trg_task_events_notify AFTER INSERT ON task_events FOR EACH ROW EXECUTE FUNCTION notify_task_event()`,

  // ── 任务指标落库：worker 每次执行写入一行，/api/metrics 聚合查询 ──
  `CREATE TABLE IF NOT EXISTS task_metrics (
    id BIGSERIAL PRIMARY KEY,
    task_id TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL,
    model TEXT,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    fallback_reviewers INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
    error TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_task_metrics_created ON task_metrics(created_at)`,
  `ALTER TABLE task_metrics ADD COLUMN IF NOT EXISTS cache_hit BOOLEAN NOT NULL DEFAULT FALSE`,

  // ── 语义缓存：相同代码+语言+模型+prompt 版本直接复用审查报告 ──
  `CREATE TABLE IF NOT EXISTS review_cache (
    code_hash TEXT PRIMARY KEY,
    report_content TEXT NOT NULL,
    score INTEGER NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`
])
