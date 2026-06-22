import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ChatMessage, TaskStatus } from '../types/index'

export const useReviewStore = defineStore('review', () => {
  const taskId = ref<string | null>(null)
  const status = ref<TaskStatus>('pending')
  const messages = ref<ChatMessage[]>([])
  const loading = ref(false)

  function addMessage(msg: Omit<ChatMessage, 'id' | 'timestamp'>) {
    messages.value.push({
      ...msg,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false })
    })
  }

  function setStatus(newStatus: TaskStatus) {
    status.value = newStatus
  }

  function setTaskId(id: string) {
    taskId.value = id
  }

  function reset() {
    taskId.value = null
    status.value = 'pending'
    messages.value = []
    loading.value = false
  }

  return { taskId, status, messages, loading, addMessage, setStatus, setTaskId, reset }
})
