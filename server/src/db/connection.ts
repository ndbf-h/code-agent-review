import { Pool, type PoolClient } from 'pg'
import { getConfig } from '../config'

let pool: Pool | null = null

/**
 * 惰性创建连接池：首次调用时才读取 DATABASE_URL，
 * 导入本模块不再产生副作用，单测无需配置数据库环境变量。
 */
export function getDb(): Pool {
  if (!pool) {
    const { databaseUrl } = getConfig()
    pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000
    })
  }
  return pool
}

/**
 * 关闭连接池。关闭期间 getDb() 仍返回正在关闭的池（pg 会对新查询报错），
 * 避免在优雅关闭窗口内悄悄新建一个永不关闭的池。
 */
export async function closeDb(): Promise<void> {
  if (!pool) return
  const current = pool
  try {
    await current.end()
  } finally {
    if (pool === current) pool = null
  }
}

/**
 * 在单个事务中执行 fn：BEGIN/COMMIT/ROLLBACK 全部托管，异常时回滚并向上抛出。
 * 用于需要行级锁或多个写操作原子生效的场景（如任务抢占）。
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getDb().connect()
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
