import { getDb } from './connection'
import { runMigrations } from './migrator'

/**
 * 初始化数据库结构：执行 db/migrations 中尚未应用的版本化迁移。
 * 表结构定义见 migrations/001_initial_schema.ts 起的各个文件。
 */
export async function initDb(): Promise<void> {
  await runMigrations(getDb())
}
