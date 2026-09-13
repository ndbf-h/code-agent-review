import { getDb } from '../db/connection'
import { createLogger } from '../logger'

const logger = createLogger('persistence')

/**
 * 创建用于 Memory.persist() 的消息插入回调
 * 将 Agent 对话历史逐条写入 messages 表
 * @returns 符合 Memory.persist() insertMessageFn 签名的异步回调
 */
export function createInsertMessageFn() {
  return async (msg: {
    id: string
    taskId: string
    agentId: string | null
    role: string
    content: string
    type: string
    createdAt: string
  }): Promise<void> => {
    const db = getDb()
    await db.query(
      'INSERT INTO messages (id, task_id, agent_id, role, content, type, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [msg.id, msg.taskId, msg.agentId, msg.role, msg.content, msg.type, msg.createdAt]
    )
  }
}
