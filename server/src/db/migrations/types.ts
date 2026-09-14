/** 执行单条 SQL 的回调，由 migrator 注入（同一连接、同一事务） */
export type MigrationExec = (sql: string) => Promise<unknown>

export interface Migration {
  /** 形如 001_initial_schema，按字典序即执行顺序，一旦发布不可修改 */
  id: string
  up(exec: MigrationExec): Promise<void>
}

/** 便捷工厂：按顺序执行一组 SQL 语句 */
export function sqlMigration(id: string, statements: string[]): Migration {
  return {
    id,
    async up(exec) {
      for (const sql of statements) {
        await exec(sql)
      }
    }
  }
}
