<script setup lang="ts">
import { computed } from 'vue'
import { useReviewStore } from '../stores/review'

const store = useReviewStore()
const slots = computed(() => store.agentSlots)

const workingCount = computed(() => slots.value.filter(s => s.status === 'working').length)
const doneCount = computed(() => slots.value.filter(s => s.status === 'done').length)

const visibleSlots = computed(() => slots.value.filter(s => s.status !== 'idle'))

function getIcon(role: string): string {
  const map: Record<string, string> = { security: '🛡️', performance: '⚡', style: '🎨', logic: '🧠' }
  return map[role] || '🔍'
}

function statusText(slot: { status: string }): string {
  const map: Record<string, string> = {
    working: '审查中...',
    done: '✅ 完成',
    error: '❌ 出错'
  }
  return map[slot.status] || '等待中'
}
</script>

<template>
  <div v-if="visibleSlots.length > 0" class="agent-grid">
    <!-- 概要栏 -->
    <div class="grid-summary">
      <span class="summary-icon">{{ workingCount > 0 ? '⏳' : '✅' }}</span>
      <span class="summary-text">
        {{ workingCount > 0
          ? `${workingCount} 位专家工作中 · ${doneCount} 位已完成`
          : `全部完成 · ${doneCount} 位专家` }}
      </span>
    </div>

    <!-- Agent 卡片网格 -->
    <div class="cards-grid">
      <div
        v-for="slot in visibleSlots"
        :key="slot.role"
        class="agent-card"
        :class="`card-${slot.status}`"
      >
        <div class="card-header">
          <span class="card-icon">{{ getIcon(slot.role) }}</span>
          <span class="card-label">{{ slot.label }}</span>
          <span class="card-status">{{ statusText(slot) }}</span>
        </div>
        <div class="card-body">
          <div class="stream-content">
            {{ slot.streamBuffer || slot.latestMessage || '准备中...' }}
            <span v-if="slot.status === 'working'" class="cursor-blink">▍</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-grid {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 16px 20px;
  box-shadow: var(--shadow-sm);
}

.grid-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border-light);
}

.summary-icon { font-size: 16px; }
.summary-text { font-size: 13px; font-weight: 600; color: var(--color-text-secondary); }

.cards-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

@media (max-width: 900px) {
  .cards-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 500px) {
  .cards-grid { grid-template-columns: 1fr; }
}

.agent-card {
  background: #fafbfc;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-card.card-working {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(59, 92, 246, 0.08);
}

.agent-card.card-done {
  opacity: 0.7;
  border-color: var(--color-success);
}

.agent-card.card-error {
  border-color: var(--color-danger);
  background: #fef2f2;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.card-icon { font-size: 16px; flex-shrink: 0; }
.card-label { font-size: 13px; font-weight: 600; color: var(--color-text); flex: 1; }
.card-status { font-size: 11px; color: var(--color-text-muted); white-space: nowrap; }

.card-body {
  font-size: 12.5px;
  color: var(--color-text-secondary);
  line-height: 1.6;
  min-height: 40px;
  max-height: 120px;
  overflow-y: auto;
}

.stream-content {
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

.cursor-blink {
  animation: blink 1s step-end infinite;
  color: var(--color-primary);
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
</style>
