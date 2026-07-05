import type { LlmMessage } from './types'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '../logger'

const logger = createLogger('memory')

const MAX_CONTEXT_CHARS = 20000

class Memory {
  private messages: LlmMessage[] = []
  private taskId?: string
  private agentId?: string
  private persistedCount = 0

  /** 绑定任务和 Agent，启用持久化 */
  bindTask(taskId: string, agentId: string): void {
    this.taskId = taskId
    this.agentId = agentId
  }

  add(message: LlmMessage): void {
    this.messages.push(message)
  }

  getContext(): LlmMessage[] {
    let totalChars = 0
    const result: LlmMessage[] = []

    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msgChars = this.messages[i].content.length
      if (totalChars + msgChars > MAX_CONTEXT_CHARS) {
        break
      }
      result.unshift(this.messages[i])
      totalChars += msgChars
    }

    return result
  }

  clear(): void {
    this.messages = []
    this.persistedCount = 0
  }

  /** 获取所有消息（用于外部持久化） */
  getAll(): LlmMessage[] {
    return [...this.messages]
  }

  /** 异步持久化新增消息到数据库 */
  async persist(
    insertMessageFn?: (msg: {
      id: string
      taskId: string
      agentId: string | null
      role: string
      content: string
      type: string
      createdAt: string
    }) => Promise<void>
  ): Promise<void> {
    if (!this.taskId || !insertMessageFn) return

    const newMessages = this.messages.slice(this.persistedCount)
    for (const msg of newMessages) {
      try {
        await insertMessageFn({
          id: uuidv4(),
          taskId: this.taskId,
          agentId: this.agentId || null,
          role: msg.role,
          content: msg.content,
          type: msg.role === 'tool' ? 'tool_result' : 'agent_thought',
          createdAt: new Date().toISOString()
        })
      } catch (error) {
        // 持久化失败不阻断流程
        logger.warn('Message persist failed', { error })
      }
    }
    this.persistedCount = this.messages.length
  }
}

export { Memory }
