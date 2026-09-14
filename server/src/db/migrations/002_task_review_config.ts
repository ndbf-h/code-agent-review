import { sqlMigration } from './types'

/**
 * 请求级审查配置（REQ-14）与任务来源（GitHub Webhook 等，REQ-15）：
 * review_config 保存 { instructions, dimensions, severityThreshold, maxIssues }，
 * source 保存 { kind, repo, pr, sha, ... }，两者均可为空。
 */
export const taskReviewConfig = sqlMigration('002_task_review_config', [
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_config JSONB`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source JSONB`
])
