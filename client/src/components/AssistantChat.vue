<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useReviewStore } from '../stores/review'
import ChatMessage from './ChatMessage.vue'
import CodeDiff from './CodeDiff.vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import type { ChatMessage as ChatMessageType } from '../types/index'
import type { FixResult } from '../types/index'
import { useChat } from '../composables/useChat'

const store = useReviewStore()
const { startReview } = useChat()
const input = ref('')
const sending = ref(false)
const messages = ref<ChatMessageType[]>([])
const proposal = ref<(FixResult & { summary: string; language: string }) | null>(null)
const proposalAccepted = ref(false)
const proposalVersionId = ref<string | null>(null)
const uploading = ref(false)
const uploadMessage = ref('')

function newMessage(role: 'user' | 'assistant', content: string): ChatMessageType {
  return {
    id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    type: role === 'user' ? 'user_input' : 'final_answer',
    timestamp: new Date().toLocaleTimeString('en-US', { hour12: false })
  }
}

async function send(): Promise<void> {
  const message = input.value.trim()
  if (!message || !store.taskId || sending.value) return

  messages.value.push(newMessage('user', message))
  input.value = ''
  const assistantMessage = newMessage('assistant', '')
  messages.value.push(assistantMessage)
  sending.value = true

  try {
    const response = await fetch(`${import.meta.env.VITE_API_BASE || 'http://localhost:3001/api'}/tasks/${store.taskId}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    })
    if (!response.ok || !response.body) throw new Error(`Assistant request failed (${response.status})`)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() || ''
      for (const event of events) {
        const dataLine = event.split('\n').find(line => line.startsWith('data: '))
        if (!dataLine) continue
        const data = JSON.parse(dataLine.slice(6)) as { content?: string; message?: string; proposal?: FixResult & { summary: string; language: string } }
        if (event.startsWith('event: token') && data.content) {
          assistantMessage.content += data.content
          await nextTick()
        }
        if (event.startsWith('event: error')) throw new Error(data.message || 'Assistant request failed')
        if (event.startsWith('event: proposal') && data.proposal) {
          proposal.value = data.proposal
          proposalAccepted.value = false
        }
      }
    }
  } catch (error) {
    assistantMessage.content = `错误：${error instanceof Error ? error.message : 'AI 对话失败'}`
  } finally {
    sending.value = false
  }
}

async function acceptProposal(): Promise<void> {
  if (!proposal.value || !store.taskId) return
  try {
    const { data } = await axios.post(`${import.meta.env.VITE_API_BASE || 'http://localhost:3001/api'}/tasks/${store.taskId}/versions`, {
      code: proposal.value.fixedCode,
      language: proposal.value.language,
      summary: 'Accepted assistant code proposal'
    })
    proposalAccepted.value = true
    proposalVersionId.value = data.version?.id || null
    ElMessage.success('修改后的代码版本已保存')
  } catch (error) {
    ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.error || '保存失败' : '保存失败')
  }
}

async function reReviewProposal(): Promise<void> {
  if (!proposal.value) return
  await startReview(proposal.value.fixedCode, proposal.value.language, store.scopeId || undefined, proposalVersionId.value || undefined)
}

async function handleFile(file: File | undefined): Promise<void> {
  if (!file || !store.taskId) return
  uploading.value = true
  uploadMessage.value = ''
  try {
    const response = await fetch(`${import.meta.env.VITE_API_BASE || 'http://localhost:3001/api'}/tasks/${store.taskId}/guidelines`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: file.name, content: await file.text() })
    })
    const data = await response.json() as { error?: string; chunkCount?: number }
    if (!response.ok) throw new Error(data.error || '上传失败')
    uploadMessage.value = `已加入知识库，切分为 ${data.chunkCount} 个片段`
  } catch (error) {
    uploadMessage.value = error instanceof Error ? error.message : '上传失败'
  } finally {
    uploading.value = false
  }
}

async function uploadGuideline(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  await handleFile(file)
}

function onDrop(event: DragEvent): void {
  const file = event.dataTransfer?.files?.[0]
  if (file) void handleFile(file)
}

function rejectProposal(): void {
  proposal.value = null
  proposalAccepted.value = false
}
</script>

<template>
  <section v-if="store.taskId && store.status === 'completed'" class="assistant-panel">
    <div class="assistant-header">
      <div>
        <h3>AI 代码助手</h3>
        <p>基于当前代码、审查报告和相关规范继续交流</p>
      </div>
      <span class="assistant-status">
        <span class="status-pulse"></span>
        RAG 已启用
      </span>
    </div>
    <div v-if="messages.length" class="assistant-messages">
      <ChatMessage v-for="message in messages" :key="message.id" :message="message" />
    </div>
    <div v-if="proposal" class="proposal-section">
      <div class="proposal-header">
        <strong>修改建议</strong>
        <span>{{ proposal.summary }}</span>
      </div>
      <CodeDiff
        :original-code="proposal.originalCode"
        :fixed-code="proposal.fixedCode"
        :changes="proposal.changes"
        :language="proposal.language"
      />
      <div class="proposal-actions">
        <button type="button" :disabled="proposalAccepted" @click="acceptProposal">{{ proposalAccepted ? '已接受' : '接受并保存版本' }}</button>
        <button type="button" :disabled="!proposalAccepted" @click="reReviewProposal">重新审查此版本</button>
        <button type="button" class="secondary" :disabled="proposalAccepted" @click="rejectProposal">拒绝修改</button>
      </div>
    </div>
    <div class="guideline-upload">
      <span class="guideline-title">添加项目代码规范</span>
      <label class="dropzone" :class="{ uploading }" @dragover.prevent @drop.prevent="onDrop">
        <input
          type="file"
          accept=".md,.markdown,.txt,.json,.yaml,.yml"
          :disabled="uploading"
          @change="uploadGuideline"
        />
        <svg class="dropzone-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M17 8l-5-5-5 5" />
          <path d="M12 3v12" />
        </svg>
        <span>{{ uploading ? '上传中...' : '点击或拖入文件（md / txt / json / yaml）' }}</span>
      </label>
      <span v-if="uploadMessage" class="upload-message" :class="{ error: uploadMessage.includes('失败') || uploadMessage.includes('不支持') }">{{ uploadMessage }}</span>
    </div>
    <div class="assistant-suggestions">
      <button type="button" @click="input = '为什么这个问题会被判定为高风险？'">为什么是高风险？</button>
      <button type="button" @click="input = '请结合项目规范给出修改建议'">给出修改建议</button>
      <button type="button" @click="input = '请解释这段代码的主要问题'">解释主要问题</button>
    </div>
    <form class="assistant-form" @submit.prevent="send">
      <textarea v-model="input" rows="2" :disabled="sending" placeholder="继续询问代码问题，或请求修改建议..." />
      <button type="submit" :disabled="sending || !input.trim()">{{ sending ? '回答中...' : '发送' }}</button>
    </form>
  </section>
</template>

<style scoped>
.assistant-panel {
  border: 1px solid var(--color-purple-border);
  border-radius: var(--radius-lg);
  background: var(--color-purple-bg);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.assistant-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.assistant-header h3 {
  margin: 0;
  color: var(--color-purple-text);
  font-size: 16px;
}

.assistant-header p {
  margin: 5px 0 0;
  color: var(--color-purple-text-muted);
  font-size: 12px;
}

.assistant-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-purple-text-secondary);
  background: var(--color-purple-chip-bg);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  white-space: nowrap;
  font-weight: 600;
}

.status-pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-accent);
  animation: status-blink 1.8s ease-in-out infinite;
}

@keyframes status-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.assistant-messages {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.assistant-messages :deep(.chat-message) {
  box-shadow: none;
  background: var(--color-surface);
}

.proposal-section {
  padding: 14px;
  background: var(--color-surface);
  border: 1px solid var(--color-purple-border);
  border-radius: var(--radius-md);
}

.proposal-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
  color: var(--color-purple-text);
}

.proposal-header span {
  color: var(--color-purple-text-muted);
  font-size: 12px;
}

.proposal-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.proposal-actions button {
  border: 0;
  border-radius: 8px;
  background: var(--color-accent);
  color: #fff;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.proposal-actions button:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
}

.proposal-actions button.secondary {
  background: var(--color-surface);
  color: var(--color-purple-text-secondary);
  border: 1px solid var(--color-purple-border);
}

.proposal-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.assistant-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.assistant-suggestions button {
  border: 1px solid var(--color-purple-border);
  background: var(--color-surface);
  color: var(--color-purple-text-secondary);
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s ease;
}

.assistant-suggestions button:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-light);
}

.assistant-form {
  display: flex;
  gap: 10px;
}

.assistant-form textarea {
  flex: 1;
  resize: vertical;
  border: 1px solid var(--color-purple-border-strong);
  border-radius: 8px;
  padding: 9px 10px;
  font: inherit;
  font-size: 13px;
  min-height: 42px;
  background: var(--color-surface);
  color: var(--color-text);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.assistant-form textarea:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-light);
}

.assistant-form button {
  align-self: flex-end;
  border: 0;
  border-radius: 8px;
  background: var(--color-accent);
  color: #fff;
  padding: 9px 16px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: opacity 0.15s ease;
}

.assistant-form button:hover:not(:disabled) {
  opacity: 0.9;
}

.assistant-form button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── 规范上传 ── */
.guideline-upload {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.guideline-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-purple-text-muted);
}

.dropzone {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 12px;
  border: 1.5px dashed var(--color-purple-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-purple-text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.dropzone:hover {
  border-color: var(--color-accent);
  background: var(--color-accent-light);
}

.dropzone.uploading {
  opacity: 0.6;
  cursor: not-allowed;
}

.dropzone input {
  display: none;
}

.dropzone-icon {
  flex-shrink: 0;
}

.upload-message {
  font-size: 12px;
  color: var(--color-success-text);
}

.upload-message.error {
  color: var(--color-danger-text);
}

@media (max-width: 600px) {
  .assistant-header { flex-direction: column; }
  .assistant-form { flex-direction: column; }
  .assistant-form button { align-self: stretch; }
}
</style>
