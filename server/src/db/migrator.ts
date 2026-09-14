import { createLogger } from '../logger'
import { migrations as allMigrations, type Migration } from './migrations/index'

const logger = createLogger('migrator')

/** 会话级咨询锁的固定键：多实例同时启动时只有一个执行迁移，其余等待后跳过 */
export const MIGRATION_LOCK_KEY = 7_240_913_001

/** migrator 需要的最小数据库接口（pg.Pool 满足） */
export interface MigrationQueryResult {
  rows: Array<Record<string, unknown>>
}

export interface MigrationClient {
  query(sql: string, params?: unknown[]): Promise<MigrationQueryResult>
  /** destroy 为 true 时销毁连接而非归还池（用于会话状态不可信的场景） */
  release(destroy?: boolean): void
}

export interface MigrationDb {
  connect(): Promise<MigrationClient>
}

export interface MigrationReport {
  applied: string[]
  skipped: string[]
}

export class MigrationError extends Error {
  constructor(
    readonly migrationId: string,
    cause: unknown
  ) {
    super(
      `迁移 ${migrationId} 执行失败: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause }
    )
    this.name = 'MigrationError'
  }
}

const ID_PATTERN = /^\d{3,}_[a-z0-9_]+$/

/** 校验清单：id 格式、唯一、递增 */
export function assertMigrationOrder(list: Migration[]): void {
  const seen = new Set<string>()
  let previous = ''
  for (const migration of list) {
    if (!ID_PATTERN.test(migration.id)) {
      throw new Error(`迁移 id 格式非法（应为 NNN_snake_case）: ${migration.id}`)
    }
    if (seen.has(migration.id)) throw new Error(`迁移 id 重复: ${migration.id}`)
    if (migration.id <= previous) {
      throw new Error(`迁移 id 必须递增: ${previous} -> ${migration.id}`)
    }
    seen.add(migration.id)
    previous = migration.id
  }
}

/**
 * 执行未应用的迁移：
 * 1. 取会话级 advisory lock（同一连接上加锁 / 解锁）
 * 2. 建 schema_migrations 表并读取已应用列表
 * 3. 逐个迁移在独立事务中执行并记录；失败回滚且不记录，随后抛出 MigrationError
 * 4. finally 解锁并归还连接
 */
export async function runMigrations(
  db: MigrationDb,
  list: Migration[] = allMigrations
): Promise<MigrationReport> {
  assertMigrationOrder(list)
  const report: MigrationReport = { applied: [], skipped: [] }
  const client = await db.connect()
  // 解锁失败时会话级锁可能残留在该连接上，归还池会阻塞其他实例，改为销毁连接
  let unlockFailed = false
  try {
    await client.query(`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`)
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
          id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        )`
      )
      const result = await client.query(`SELECT id FROM schema_migrations`)
      const appliedIds = new Set(result.rows.map(row => String(row.id)))

      for (const migration of list) {
        if (appliedIds.has(migration.id)) {
          report.skipped.push(migration.id)
          continue
        }
        logger.info('应用迁移', { id: migration.id })
        await client.query('BEGIN')
        try {
          await migration.up(sql => client.query(sql))
          await client.query(`INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)`, [
            migration.id,
            new Date().toISOString()
          ])
          await client.query('COMMIT')
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined)
          throw new MigrationError(migration.id, error)
        }
        report.applied.push(migration.id)
      }
    } finally {
      await client.query(`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`).catch(() => {
        unlockFailed = true
      })
    }
  } finally {
    client.release(unlockFailed ? true : undefined)
  }
  logger.info('迁移完成', { applied: report.applied.length, skipped: report.skipped.length })
  return report
}
