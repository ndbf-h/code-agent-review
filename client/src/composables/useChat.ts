import { ref } from 'vue'
import axios from 'axios'
import { useReviewStore } from '../stores/review'
import { useSSE } from './useSSE'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api'

export function useChat() {
  const store = useReviewStore()
  const { connect, disconnect } = useSSE()
  const codeInput = ref('')
  const language = ref('typescript')
  const lastCode = ref('')
  const lastLang = ref('typescript')
  const lastError = ref<string | null>(null)

  async function startReview(
    code: string,
    lang: string,
    requestedScopeId?: string,
    sourceVersionId?: string
  ) {
    const reviewScopeId = requestedScopeId || store.scopeId
    store.reset()
    store.loading = true
    lastCode.value = code
    lastLang.value = lang
    lastError.value = null

    store.addMessage({
      role: 'user',
      content: `提交了 ${lang} 代码进行审查`,
      type: 'user_input'
    })

    try {
      const response = await axios.post(`${API_BASE}/tasks`, {
        code,
        language: lang,
        title: `Review - ${new Date().toLocaleTimeString()}`,
        scopeId: reviewScopeId || undefined,
        sourceVersionId
      })

      const taskId = response.data.id
      store.setTaskId(taskId)
      if (response.data.scopeId) store.setScopeId(response.data.scopeId)
      connect(taskId)
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建任务失败'
      lastError.value = message
      store.addMessage({
        role: 'system',
        content: `错误：${message}`,
        type: 'agent_thought'
      })
      store.loading = false
    }
  }

  async function retry() {
    if (!lastCode.value.trim()) return
    await startReview(lastCode.value, lastLang.value)
  }

  return { codeInput, language, lastCode, lastLang, lastError, startReview, retry, disconnect }
}
