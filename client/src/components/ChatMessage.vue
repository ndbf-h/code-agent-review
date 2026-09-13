<script setup lang="ts">
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import type { ChatMessage as ChatMessageType } from '../types/index'

const props = defineProps<{
  message: ChatMessageType
  onRetry?: () => void
}>()

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
})

const isError = computed(() =>
  props.message.role === 'system' && props.message.content.startsWith('错误：')
)

const renderedContent = computed(() => {
  if (props.message.type === 'tool_call') return ''
  if (props.message.role === 'user' || props.message.role === 'system') return ''
  return md.render(props.message.content)
})

function getRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    user: '你',
    orchestrator: '协调者',
    security: '安全审查专家',
    performance: '性能优化专家',
    style: '代码规范专家',
    logic: '逻辑审查专家',
    system: '系统'
  }
  return role === 'assistant' ? 'AI 代码助手' : (labels[role] || role)
}

function getRoleClass(role: string): string {
  if (role === 'user') return 'role-user'
  if (role === 'orchestrator') return 'role-orch'
  return 'role-agent'
}
</script>

<template>
  <div class="chat-message" :class="[getRoleClass(message.role), { 'is-error': isError }]">
    <div class="message-header">
      <span class="message-role">{{ getRoleLabel(message.role) }}</span>
      <span class="message-time">{{ message.timestamp }}</span>
    </div>
    <div class="message-body">
      <div class="message-line"></div>
      <div class="message-content">
        <p v-if="message.type === 'tool_call'" class="tool-call">
          <span class="tool-name">工具：{{ message.toolName }}</span>
          {{ message.content }}
        </p>
        <div v-else-if="renderedContent" class="markdown-body" v-html="renderedContent"></div>
        <p v-else>{{ message.content }}</p>
      </div>
      <div v-if="isError && onRetry" class="message-actions">
        <el-button size="small" type="danger" plain @click="onRetry">
          重试
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-message {
  animation: fadeIn 0.3s ease;
  padding: 16px 20px;
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.message-role {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.1px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.message-role::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-border);
}

.role-orch .message-role { color: var(--color-primary); }
.role-orch .message-role::before { background: var(--color-primary); }

.role-agent .message-role { color: var(--color-success-text); }
.role-agent .message-role::before { background: #10b981; }

.role-user .message-role { color: var(--color-warning-text); }
.role-user .message-role::before { background: #f59e0b; }

.message-time {
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-muted);
}

.message-body {
  display: flex;
  gap: 14px;
}

.message-line {
  width: 3px;
  min-width: 3px;
  border-radius: 2px;
  background: var(--color-border);
}

.role-orch .message-line {
  background: linear-gradient(180deg, var(--color-primary), var(--color-accent));
}

.role-agent .message-line {
  background: linear-gradient(180deg, #10b981, #34d399);
}

.role-assistant .message-role { color: var(--color-accent); }
.role-assistant .message-role::before { background: #8b5cf6; }
.role-assistant .message-line {
  background: linear-gradient(180deg, #8b5cf6, #c084fc);
}

.role-user .message-line {
  background: linear-gradient(180deg, #f59e0b, #fbbf24);
}

.message-content {
  font-size: 14px;
  line-height: 1.75;
  color: var(--color-text-secondary);
}

.message-content p {
  margin: 0;
}

.tool-call {
  font-size: 13px;
  color: var(--color-text-muted);
}

.tool-name {
  display: inline-block;
  background: var(--color-primary-light);
  color: var(--color-primary);
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  margin-right: 8px;
  letter-spacing: -0.1px;
}

.chat-message.is-error {
  border-left: 3px solid var(--color-danger);
  background: var(--color-danger-bg);
}

/* ── Markdown ── */
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3) {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text);
  margin: 12px 0 6px;
}

.markdown-body :deep(h1) { font-size: 17px; }
.markdown-body :deep(h3) { font-size: 14px; }

.markdown-body :deep(p) {
  margin: 0 0 6px;
  line-height: 1.7;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 20px;
  margin: 4px 0 8px;
}

.markdown-body :deep(li) {
  margin-bottom: 2px;
  line-height: 1.6;
}

.markdown-body :deep(code) {
  background: var(--color-code-bg);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 13px;
}

.markdown-body :deep(pre) {
  background: var(--color-pre-bg);
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  font-size: 13px;
  border: 1px solid var(--color-border-light);
  margin: 8px 0;
}

.markdown-body :deep(pre code) {
  background: none;
  padding: 0;
}

.markdown-body :deep(blockquote) {
  border-left: 3px solid var(--color-primary);
  padding-left: 12px;
  color: var(--color-text-secondary);
  margin: 8px 0;
}

.markdown-body :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 8px 0;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid var(--color-border-light);
  padding: 6px 10px;
  font-size: 13px;
  text-align: left;
}

.markdown-body :deep(th) {
  background: var(--color-table-head-bg);
  font-weight: 600;
}

.markdown-body :deep(strong) {
  font-weight: 600;
  color: var(--color-text);
}

.markdown-body :deep(a) {
  color: var(--color-primary);
}

.message-actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}
</style>
