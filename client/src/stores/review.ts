import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ChatMessage, TaskStatus, AgentRole } from '../types/index'

interface AgentSlot {
  role: AgentRole
  label: string
  status: 'idle' | 'working' | 'done' | 'error'
  latestMessage: string
  streamBuffer?: string
}

const AGENT_LABELS: Record<string, string> = {
  security: '安全审查',
  performance: '性能优化',
  style: '代码规范',
  logic: '逻辑审查'
}

export const useReviewStore = defineStore('review', () => {
  const taskId = ref<string | null>(null)
  const status = ref<TaskStatus>('pending')
  const messages = ref<ChatMessage[]>([])
  const loading = ref(false)
  const agentSlots = ref<AgentSlot[]>([])

  function addMessage(msg: Omit<ChatMessage, 'id' | 'timestamp'>) {
    messages.value.push({
      ...msg,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false })
    })
  }

  /** 追加流式 token 到指定 Agent 的思考内容 */
  function appendToken(role: AgentRole, token: string): void {
    const idx = agentSlots.value.findIndex(s => s.role === role)
    if (idx >= 0) {
      agentSlots.value[idx].streamBuffer = (agentSlots.value[idx].streamBuffer || '') + token
      agentSlots.value[idx].latestMessage = agentSlots.value[idx].streamBuffer || ''
    }
  }

  function upsertAgentSlot(role: AgentRole, info: Partial<Pick<AgentSlot, 'status' | 'latestMessage'>>) {
    const idx = agentSlots.value.findIndex(s => s.role === role)
    if (idx >= 0) {
      if (info.status !== undefined) agentSlots.value[idx].status = info.status
      if (info.latestMessage !== undefined) agentSlots.value[idx].latestMessage = info.latestMessage
    } else {
      agentSlots.value.push({
        role,
        label: AGENT_LABELS[role] || role,
        status: info.status || 'working',
        latestMessage: info.latestMessage || ''
      })
    }
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
    agentSlots.value = []
  }

  return { taskId, status, messages, loading, agentSlots, addMessage, upsertAgentSlot, appendToken, setStatus, setTaskId, reset }
})
