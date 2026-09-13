import { Pool, type PoolClient } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:123456@localhost:5432/code_review',
  max: 10,
  idleTimeoutMillis: 30000
})

export function getDb(): Pool {
  return pool
}

export async function closeDb(): Promise<void> {
  await pool.end()
}

/**
 * 在单个事务中执行 fn：BEGIN/COMMIT/ROLLBACK 全部托管，异常时回滚并向上抛出。
 * 用于需要行级锁或多个写操作原子生效的场景（如任务抢占）。
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // 连接已断开时 ROLLBACK 会失败，此时连接销毁即自动回滚
    }
    throw error
  } finally {
    client.release()
  }
}
