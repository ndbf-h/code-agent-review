import { sqlMigration } from './types'

/**
 * 外部来源任务去重（优化方案 P0-3）：GitHub 在 Webhook 超时后会重投，同一 headSha 不应产生多个任务。
 *
 * 没有直接在 source 的表达式上建唯一索引：历史库里可能已有重复投递产生的任务，
 * 那样建索引会让迁移失败。改为新增 dedupe_key 列，只有新写入的外部来源任务才填写，
 * 历史行保持 NULL，部分唯一索引只约束非空值。
 */
export const taskSourceDedupe = sqlMigration('003_task_source_dedupe', [
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS dedupe_key TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_dedupe_key ON tasks (dedupe_key) WHERE dedupe_key IS NOT NULL`
])
