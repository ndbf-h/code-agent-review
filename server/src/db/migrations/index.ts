import type { Migration } from './types'
import { initialSchema } from './001_initial_schema'
import { taskReviewConfig } from './002_task_review_config'

export type { Migration, MigrationExec } from './types'

/**
 * 有序迁移清单：新增迁移追加到数组末尾，id 递增；已发布的迁移不得修改。
 * migrator 会校验 id 唯一且按字典序递增。
 */
export const migrations: Migration[] = [initialSchema, taskReviewConfig]
