import { describe, it, expect } from 'vitest'
import {
  runMigrations,
  assertMigrationOrder,
  MigrationError,
  MIGRATION_LOCK_KEY,
  type MigrationDb
} from '../migrator'
import { migrations } from '../migrations/index'
import type { Migration } from '../migrations/types'

interface FakeOptions {
  applied?: string[]
  failOn?: (sql: string) => boolean
}

/** 记录全部 SQL 的假数据库；schema_migrations 查询返回预置的已应用列表 */
function fakeDb(options: FakeOptions = {}) {
  const sql: string[] = []
  const params: unknown[][] = []
  let released = 0
  const releaseArgs: unknown[] = []
  const db: MigrationDb = {
    async connect() {
      return {
        async query(text: string, values?: unknown[]) {
          sql.push(text)
          if (values) params.push(values)
          if (options.failOn?.(text)) throw new Error('boom: ' + text.slice(0, 30))
          if (text.startsWith('SELECT id FROM schema_migrations')) {
            return { rows: (options.applied ?? []).map(id => ({ id })) }
          }
          return { rows: [] }
        },
        release(destroy?: boolean) {
          released++
          releaseArgs.push(destroy)
        }
      }
    }
  }
  return { db, sql, params, released: () => released, releaseArgs }
}

const m = (id: string, statements: string[]): Migration => ({
  id,
  async up(exec) {
    for (const s of statements) await exec(s)
  }
})

const sample = [
  m('001_first', ['CREATE TABLE a (id int)']),
  m('002_second', ['ALTER TABLE a ADD b int'])
]

describe('runMigrations', () => {
  it('按顺序执行全部迁移，每个迁移独立事务并记录到 schema_migrations', async () => {
    const fake = fakeDb()
    const report = await runMigrations(fake.db, sample)

    expect(report).toEqual({ applied: ['001_first', '002_second'], skipped: [] })
    const executed = fake.sql.filter(s => /^(CREATE TABLE a|ALTER TABLE a)/.test(s))
    expect(executed).toEqual(['CREATE TABLE a (id int)', 'ALTER TABLE a ADD b int'])

    // 每个迁移：BEGIN → 语句 → INSERT 记录 → COMMIT
    const firstBegin = fake.sql.indexOf('BEGIN')
    expect(fake.sql[firstBegin + 1]).toBe('CREATE TABLE a (id int)')
    expect(fake.sql[firstBegin + 2]).toMatch(/INSERT INTO schema_migrations/)
    expect(fake.sql[firstBegin + 3]).toBe('COMMIT')
    expect(fake.params.map(p => p[0])).toEqual(['001_first', '002_second'])
    expect(fake.released()).toBe(1)
  })

  it('已应用的迁移跳过，只执行新增的', async () => {
    const fake = fakeDb({ applied: ['001_first'] })
    const report = await runMigrations(fake.db, sample)
    expect(report).toEqual({ applied: ['002_second'], skipped: ['001_first'] })
    expect(fake.sql).not.toContain('CREATE TABLE a (id int)')
    expect(fake.sql).toContain('ALTER TABLE a ADD b int')
  })

  it('迁移失败时回滚、不记录、抛出 MigrationError 并仍然解锁', async () => {
    const fake = fakeDb({ failOn: sql => sql.startsWith('ALTER TABLE a') })
    await expect(runMigrations(fake.db, sample)).rejects.toBeInstanceOf(MigrationError)
    await expect(runMigrations(fake.db, sample)).rejects.toThrow(/002_second/)

    const firstRun = fake.sql
    expect(firstRun).toContain('ROLLBACK')
    // 失败的迁移没有 INSERT 记录（只有第一条成功的迁移有）
    expect(fake.params.map(p => p[0])).toEqual(['001_first', '001_first'])
    expect(firstRun.filter(s => s.includes('pg_advisory_unlock'))).toHaveLength(2)
    expect(fake.released()).toBe(2)
  })

  it('加锁与解锁成对出现且使用同一固定键，解锁在所有语句之后', async () => {
    const fake = fakeDb()
    await runMigrations(fake.db, sample)
    const lockIndex = fake.sql.findIndex(s => s.includes(`pg_advisory_lock(${MIGRATION_LOCK_KEY})`))
    const unlockIndex = fake.sql.findIndex(s =>
      s.includes(`pg_advisory_unlock(${MIGRATION_LOCK_KEY})`)
    )
    expect(lockIndex).toBe(0)
    expect(unlockIndex).toBe(fake.sql.length - 1)
    expect(fake.sql[1]).toMatch(/CREATE TABLE IF NOT EXISTS schema_migrations/)
  })

  it('正常路径归还连接；解锁失败时销毁连接而非归还池', async () => {
    const ok = fakeDb()
    await runMigrations(ok.db, sample)
    expect(ok.releaseArgs).toEqual([undefined])

    const broken = fakeDb({ failOn: sql => sql.includes('pg_advisory_unlock') })
    await runMigrations(broken.db, sample)
    expect(broken.releaseArgs).toEqual([true])
  })

  it('清单顺序非法时在触碰数据库之前抛错', async () => {
    const fake = fakeDb()
    await expect(runMigrations(fake.db, [m('002_b', []), m('001_a', [])])).rejects.toThrow(/递增/)
    await expect(runMigrations(fake.db, [m('001_a', []), m('001_a', [])])).rejects.toThrow(/重复/)
    await expect(runMigrations(fake.db, [m('bad id', [])])).rejects.toThrow(/格式非法/)
    expect(fake.sql).toHaveLength(0)
  })
})

describe('内置迁移清单', () => {
  it('id 合法、唯一且递增', () => {
    expect(() => assertMigrationOrder(migrations)).not.toThrow()
    expect(migrations.map(x => x.id)).toEqual(['001_initial_schema', '002_task_review_config'])
  })

  it('001 覆盖全部核心表且语句幂等（IF NOT EXISTS / OR REPLACE）', async () => {
    const statements: string[] = []
    await migrations[0].up(async sql => {
      statements.push(sql)
    })
    const ddl = statements.join('\n')
    for (const table of [
      'tasks',
      'agents',
      'messages',
      'tool_calls',
      'reports',
      'conversation_messages',
      'code_versions',
      'knowledge_documents',
      'knowledge_chunks',
      'task_events',
      'task_metrics',
      'review_cache'
    ]) {
      expect(ddl).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`))
    }
    for (const sql of statements) {
      if (/^CREATE TABLE/.test(sql)) expect(sql).toMatch(/IF NOT EXISTS/)
      if (/^CREATE INDEX/.test(sql)) expect(sql).toMatch(/IF NOT EXISTS/)
      if (/^ALTER TABLE .* ADD COLUMN/.test(sql)) expect(sql).toMatch(/IF NOT EXISTS/)
      if (/^CREATE OR REPLACE FUNCTION|^DROP TRIGGER|^CREATE TRIGGER|^UPDATE/.test(sql)) continue
    }
    expect(ddl).toMatch(/pg_notify\('task_events'/)
  })

  it('002 为 tasks 增加 review_config 与 source JSONB 列', async () => {
    const statements: string[] = []
    await migrations[1].up(async sql => {
      statements.push(sql)
    })
    expect(statements).toEqual([
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_config JSONB',
      'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source JSONB'
    ])
  })
})
