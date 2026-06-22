import type { LlmMessage } from './types'

const MAX_CONTEXT_CHARS = 20000

class Memory {
  private messages: LlmMessage[] = []

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
  }
}

export { Memory }
