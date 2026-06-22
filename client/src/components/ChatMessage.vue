<script setup lang="ts">
import type { ChatMessage as ChatMessageType } from '../types/index'

defineProps<{
  message: ChatMessageType
}>()

function getRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    user: 'You',
    orchestrator: 'Orchestrator',
    security: 'Security Reviewer',
    performance: 'Performance Reviewer',
    style: 'Style Reviewer',
    logic: 'Logic Reviewer',
    system: 'System'
  }
  return labels[role] || role
}

function getRoleClass(role: string): string {
  if (role === 'user') return 'role-user'
  if (role === 'orchestrator') return 'role-orch'
  return 'role-agent'
}
</script>

<template>
  <div class="chat-message" :class="getRoleClass(message.role)">
    <div class="message-header">
      <span class="message-role">{{ getRoleLabel(message.role) }}</span>
      <span class="message-time">{{ message.timestamp }}</span>
    </div>
    <div class="message-body">
      <div class="message-line"></div>
      <div class="message-content">
        <p v-if="message.type !== 'tool_call'">{{ message.content }}</p>
        <p v-else class="tool-call">
          <span class="tool-name">Tool: {{ message.toolName }}</span>
          {{ message.content }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-message {
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.message-role {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.role-orch .message-role {
  color: #409eff;
}

.role-agent .message-role {
  color: #67c23a;
}

.role-user .message-role {
  color: #e6a23c;
}

.message-time {
  font-size: 11px;
  color: #c0c4cc;
}

.message-body {
  display: flex;
  gap: 12px;
}

.message-line {
  width: 2px;
  min-width: 2px;
  background: #e4e7ed;
  border-radius: 1px;
}

.role-orch .message-line {
  background: #409eff;
}

.role-agent .message-line {
  background: #67c23a;
}

.role-user .message-line {
  background: #e6a23c;
}

.message-content {
  font-size: 14px;
  line-height: 1.7;
  color: #606266;
}

.tool-call {
  font-size: 13px;
  color: #909399;
}

.tool-name {
  display: inline-block;
  background: #ecf5ff;
  color: #409eff;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 12px;
  margin-right: 6px;
}
</style>
