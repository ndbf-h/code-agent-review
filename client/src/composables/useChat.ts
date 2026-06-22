import { ref } from 'vue'
import axios from 'axios'
import { useReviewStore } from '../stores/review'
import { useSSE } from './useSSE'

const API_BASE = 'http://localhost:3001/api'

export function useChat() {
  const store = useReviewStore()
  const { connect, disconnect } = useSSE()
  const codeInput = ref('')
  const language = ref('typescript')

  async function startReview(code: string, lang: string) {
    store.reset()
    store.loading = true

    store.addMessage({
      role: 'user',
      content: `提交了 ${lang} 代码进行审查`,
      type: 'user_input'
    })

    try {
      const response = await axios.post(`${API_BASE}/tasks`, {
        code,
        language: lang,
        title: `Review - ${new Date().toLocaleTimeString()}`
      })

      const taskId = response.data.id
      store.setTaskId(taskId)
      connect(taskId)
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建任务失败'
      store.addMessage({
        role: 'system',
        content: `错误：${message}`,
        type: 'agent_thought'
      })
      store.loading = false
    }
  }

  return { codeInput, language, startReview, disconnect }
}
