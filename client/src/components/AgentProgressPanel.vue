<script setup lang="ts">
import { computed } from 'vue'
import { useReviewStore } from '../stores/review'

const store = useReviewStore()

const slots = computed(() => store.agentSlots)

const workingCount = computed(() => slots.value.filter(s => s.status === 'working').length)
const doneCount = computed(() => slots.value.filter(s => s.status === 'done').length)
const allDone = computed(() => slots.value.length > 0 && workingCount.value === 0)

const statusText = computed(() => {
  if (allDone.value) return `全部完成 · ${doneCount.value} 位专家`
  if (workingCount.value > 0) return `${workingCount.value} 位审查中 · ${doneCount.value} 位已完成`
  return '等待中...'
})

function getIcon(role: string): string {
  const map: Record<string, string> = { security: '🛡️', performance: '⚡', style: '🎨', logic: '🧠' }
  return map[role] || '🔍'
}
</script>

<template>
  <div class="agent-panel" :class="{ 'all-done': allDone }">
    <div class="panel-header">
      <span class="panel-title">审查进度</span>
      <span class="panel-status">{{ statusText }}</span>
    </div>
    <transition name="collapse">
      <div v-if="!allDone" class="agent-list">
        <div
          v-for="slot in slots"
          :key="slot.role"
          class="agent-row"
          :class="`status-${slot.status}`"
        >
          <span class="agent-icon">{{ getIcon(slot.role) }}</span>
          <span class="agent-label">{{ slot.label }}</span>
          <span class="agent-dot"></span>
          <span class="agent-msg">{{ slot.latestMessage }}</span>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.agent-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  padding: 14px 18px;
  box-shadow: var(--shadow-sm);
  transition: opacity 0.4s ease, background 0.4s ease;
}

.agent-panel.all-done {
  opacity: 0.65;
  background: #fafbfc;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.panel-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 6px;
}

.panel-title::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-primary);
  animation: pulse-dot 1.5s ease-in-out infinite;
}

.all-done .panel-title::before {
  background: var(--color-success);
  animation: none;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(1.3); }
}

.panel-status {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.agent-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: hidden;
}

.agent-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 4px 0;
  transition: opacity 0.3s ease;
}

.agent-row.status-done {
  opacity: 0.5;
}

.agent-icon {
  font-size: 14px;
  line-height: 1;
  flex-shrink: 0;
}

.agent-label {
  font-weight: 500;
  color: var(--color-text-secondary);
  min-width: 60px;
}

.agent-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-muted);
  flex-shrink: 0;
  transition: background 0.3s ease;
}

.status-working .agent-dot {
  background: var(--color-primary);
  animation: pulse-dot 1.2s ease-in-out infinite;
}

.status-done .agent-dot {
  background: var(--color-success);
}

.status-error .agent-dot {
  background: var(--color-danger);
}

.agent-msg {
  color: var(--color-text-muted);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

/* collapse transition */
.collapse-enter-active,
.collapse-leave-active {
  transition: all 0.3s ease;
  max-height: 200px;
}

.collapse-enter-from,
.collapse-leave-to {
  max-height: 0;
  opacity: 0;
  margin-top: 0;
}
</style>
