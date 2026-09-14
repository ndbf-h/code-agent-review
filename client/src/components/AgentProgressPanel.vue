<script setup lang="ts">
import { computed } from 'vue'
import { useReviewStore } from '../stores/review'

const store = useReviewStore()
const slots = computed(() => store.agentSlots)

const workingCount = computed(() => slots.value.filter(s => s.status === 'working').length)
const doneCount = computed(() => slots.value.filter(s => s.status === 'done').length)

const visibleSlots = computed(() => slots.value.filter(s => s.status !== 'idle'))

// 排队态：任务已入队但尚未被 worker 领走，slots 还未创建
const isQueued = computed(() => store.status === 'pending' && store.loading)

function statusText(slot: { status: string }): string {
  const map: Record<string, string> = {
    working: '审查中',
    done: '已完成',
    error: '出错'
  }
  return map[slot.status] || '等待中'
}

// ── 阶段时间线：排队 → 编排 → 审查 → 汇总 → 完成 ──
const phases = [
  { key: 'pending', label: '排队' },
  { key: 'orchestrating', label: '编排' },
  { key: 'reviewing', label: '审查' },
  { key: 'summarizing', label: '汇总' },
  { key: 'completed', label: '完成' }
]

const phaseIndex = computed(() => {
  const map: Record<string, number> = {
    pending: 0,
    orchestrating: 1,
    reviewing: 2,
    summarizing: 3,
    completed: 4
  }
  return map[store.status] ?? -1
})
</script>

<template>
  <div v-if="visibleSlots.length > 0 || isQueued" class="agent-grid">
    <!-- 阶段时间线 -->
    <div class="phase-timeline" role="list" aria-label="审查阶段">
      <template v-for="(phase, i) in phases" :key="phase.key">
        <div
          class="phase-step"
          :class="{ done: i < phaseIndex, active: i === phaseIndex }"
          role="listitem"
        >
          <span class="phase-dot"></span>
          <span class="phase-label">{{ phase.label }}</span>
        </div>
        <span
          v-if="i < phases.length - 1"
          class="phase-line"
          :class="{ done: i < phaseIndex }"
        ></span>
      </template>
    </div>

    <!-- 概要栏 -->
    <div class="grid-summary">
      <span class="summary-dot" :class="{ active: workingCount > 0 || isQueued }"></span>
      <span class="summary-text">
        {{
          isQueued
            ? '任务排队中，等待空闲执行位...'
            : workingCount > 0
              ? `${workingCount} 位专家工作中 · ${doneCount} 位已完成`
              : `全部完成 · ${doneCount} 位专家`
        }}
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
          <span class="card-icon" :class="`icon-${slot.role}`">
            <!-- 安全盾牌 -->
            <svg
              v-if="slot.role === 'security'"
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3l7 3v5c0 4.6-3 7.7-7 9-4-1.3-7-4.4-7-9V6z" />
              <path d="M9.2 12.2l2 2 3.6-4.2" />
            </svg>
            <!-- 性能闪电 -->
            <svg
              v-else-if="slot.role === 'performance'"
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M13 2 5 13h5l-1 9 8-11h-5z" />
            </svg>
            <!-- 规范画笔 -->
            <svg
              v-else-if="slot.role === 'style'"
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M14.5 3.5a3.5 3.5 0 0 1 5 5L9 19l-5 1 1-5z" />
              <path d="M13.5 5.5l5 5" />
            </svg>
            <!-- 逻辑芯片 -->
            <svg
              v-else
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect x="7" y="7" width="10" height="10" rx="2" />
              <rect x="10" y="10" width="4" height="4" />
              <path d="M12 3v2M12 19v2M3 12h2M19 12h2" />
            </svg>
          </span>
          <span class="card-label">{{ slot.label }}</span>
          <span class="card-status" :class="`status-${slot.status}`">
            <span class="status-dot"></span>
            {{ statusText(slot) }}
          </span>
        </div>
        <div class="card-body">
          <div class="stream-content">
            {{ slot.streamBuffer || slot.latestMessage || '准备中...' }}
            <span v-if="slot.status === 'working'" class="cursor-blink">▍</span>
          </div>
        </div>
        <div class="card-progress">
          <span
            class="progress-fill"
            :class="{
              indeterminate: slot.status === 'working',
              complete: slot.status === 'done',
              error: slot.status === 'error'
            }"
          ></span>
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

/* ── 阶段时间线 ── */
.phase-timeline {
  display: flex;
  align-items: center;
  margin-bottom: 14px;
}

.phase-step {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-muted);
}

.phase-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-border);
  transition: all 0.25s ease;
}

.phase-step.done .phase-dot,
.phase-step.active .phase-dot {
  background: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-light);
}

.phase-step.active .phase-dot {
  animation: pulse-dot 1.6s ease-in-out infinite;
}

.phase-step.active .phase-label {
  color: var(--color-primary);
  font-weight: 600;
}

.phase-step.done .phase-label {
  color: var(--color-text-secondary);
}

.phase-label {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.phase-line {
  flex: 1;
  height: 2px;
  margin: 0 10px;
  border-radius: 1px;
  background: var(--color-border-light);
  transition: background 0.25s ease;
}

.phase-line.done {
  background: var(--color-primary);
}

@keyframes pulse-dot {
  0%,
  100% {
    box-shadow: 0 0 0 3px var(--color-primary-light);
  }
  50% {
    box-shadow: 0 0 0 6px var(--color-primary-light);
  }
}

.grid-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border-light);
}

.summary-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-success);
}

.summary-dot.active {
  background: var(--color-primary);
  animation: pulse-dot 1.6s ease-in-out infinite;
}

.summary-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

@media (max-width: 900px) {
  .cards-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 500px) {
  .cards-grid {
    grid-template-columns: 1fr;
  }
}

.agent-card {
  background: var(--color-surface-2);
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
  opacity: 0.82;
  border-color: var(--color-success);
}

.agent-card.card-error {
  border-color: var(--color-danger);
  background: var(--color-danger-bg);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  flex-shrink: 0;
}

.icon-security {
  color: var(--color-info-text);
  background: var(--color-info-bg);
}
.icon-performance {
  color: var(--color-warning-text);
  background: var(--color-warning-bg);
}
.icon-style {
  color: var(--color-accent);
  background: var(--color-accent-light);
}
.icon-logic {
  color: var(--color-success-text);
  background: var(--color-success-bg);
}

.card-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  flex: 1;
}

.card-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-border);
}

.status-working .status-dot {
  background: var(--color-primary);
  animation: pulse-dot 1.6s ease-in-out infinite;
}

.status-done .status-dot {
  background: var(--color-success);
}
.status-error .status-dot {
  background: var(--color-danger);
}
.status-done {
  color: var(--color-success-text);
}
.status-error {
  color: var(--color-danger-text);
}

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
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

/* ── 进度条 ── */
.card-progress {
  height: 3px;
  border-radius: 2px;
  background: var(--color-border-light);
  overflow: hidden;
}

.progress-fill {
  display: block;
  height: 100%;
  width: 0;
  border-radius: inherit;
  transition: width 0.4s ease;
}

.progress-fill.indeterminate {
  width: 40%;
  background: linear-gradient(90deg, transparent, var(--color-primary), transparent);
  animation: slide 1.1s ease-in-out infinite;
}

.progress-fill.complete {
  width: 100%;
  background: var(--color-success);
}

.progress-fill.error {
  width: 100%;
  background: var(--color-danger);
}

@keyframes slide {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(320%);
  }
}
</style>
