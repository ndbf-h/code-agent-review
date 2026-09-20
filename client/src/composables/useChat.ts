import { ref } from 'vue'
import { http } from '../api/http'
import { useReviewStore } from '../stores/review'
import { useSSE } from './useSSE'
import type { ReviewConfig } from '../types/index'

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
    sourceVersionId?: string,
    reviewConfig?: ReviewConfig
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
      // REQ-14：仅在用户实际设置时才附带 reviewConfig，保持请求体整洁
      const hasReviewConfig =
        !!reviewConfig &&
        (!!reviewConfig.instructions ||
          !!reviewConfig.dimensions?.length ||
          !!reviewConfig.severityThreshold ||
          reviewConfig.maxIssues !== undefined)

      const response = await http.post('/tasks', {
        code,
        language: lang,
        title: `Review - ${new Date().toLocaleTimeString()}`,
        scopeId: reviewScopeId || undefined,
        sourceVersionId,
        reviewConfig: hasReviewConfig ? reviewConfig : undefined
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
