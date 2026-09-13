<script setup lang="ts">
import { computed } from 'vue'
import { useReviewStore } from '../stores/review'
import AgentProgressPanel from './AgentProgressPanel.vue'

/**
 * 过程面板（工作台左栏）：Agent 执行状态 + 事件时间线。
 * 结果优先原则：任务完成后默认由父组件收起，可随时展开回看。
 */
const store = useReviewStore()

const props = defineProps<{
  collapsed?: boolean
}>()

/** 事件时间线：过滤掉用户输入与最终报告卡片，只保留过程事件 */
const streamEvents = computed(() =>
  store.messages.filter(m => m.type !== 'report' && !(m.role === 'user' && m.type === 'user_input'))
)

function eventIcon(type: string): string {
  if (type === 'tool_call') return '🔧'
  if (type === 'task_queued' || type === 'task_retrying') return '⏳'
  if (type === 'task_state') return '📌'
  return '💭'
}

function eventRole(role: string): string {
  const map: Record<string, string> = {
    orchestrator: '协调者',
    security: '安全',
    performance: '性能',
    style: '规范',
    logic: '逻辑',
    system: '系统',
    user: '你'
  }
  return map[role] || role
}
</script>

<template>
  <div v-show="!collapsed" class="process-panel">
    <div class="panel-head">
      <span class="panel-title">执行过程</span>
      <span class="panel-hint">{{ store.loading ? '实时' : '已结束' }}</span>
    </div>

    <div class="panel-scroll">
      <AgentProgressPanel />

      <div v-if="streamEvents.length > 0" class="event-timeline">
        <div v-for="(msg, idx) in streamEvents" :key="msg.id || idx" class="event-item">
          <span class="event-icon">{{ eventIcon(msg.type) }}</span>
          <div class="event-body">
            <span class="event-role">{{ eventRole(msg.role) }}</span>
            <span class="event-text">{{ msg.content }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.process-panel {
  width: 264px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-light);
}

.panel-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text);
}

.panel-hint {
  font-size: 11px;
  color: var(--color-text-muted);
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--color-surface-2);
}

.panel-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* 让内嵌的 AgentProgressPanel 在窄栏下单列排布 */
.panel-scroll :deep(.cards-grid) {
  grid-template-columns: 1fr;
}

.event-timeline {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.event-item {
  display: flex;
  gap: 8px;
  padding: 7px 9px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-light);
}

.event-icon {
  font-size: 12px;
  line-height: 1.4;
  flex-shrink: 0;
}

.event-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.event-role {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
}

.event-text {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.55;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
