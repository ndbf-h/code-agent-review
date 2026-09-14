<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Issue, ReviewReport as ReviewReportType } from '../types/index'
import AssistantChat from './AssistantChat.vue'
import MetricsPanel from './MetricsPanel.vue'

/**
 * 上下文面板（工作台右栏）：选中问题的完整详情 + AI 助手 + 指标。
 * 由父组件通过 v-if 控制显隐（窄屏转为覆盖抽屉）。
 */
const props = defineProps<{
  taskId: string | null
  report: ReviewReportType | null
  selectedIssue: Issue | null
  code?: string
  language?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

type Tab = 'issue' | 'assistant' | 'metrics'
const activeTab = ref<Tab>('issue')

// 选中新问题时自动切到详情 tab
watch(
  () => props.selectedIssue,
  issue => {
    if (issue) activeTab.value = 'issue'
  }
)

const dimLabels: Record<string, string> = {
  security: '安全',
  performance: '性能',
  style: '规范',
  logic: '逻辑'
}

function severityLabel(severity: string): string {
  const map: Record<string, string> = { critical: '高危', warning: '警告', suggestion: '建议' }
  return map[severity] || severity
}

function dimensionOf(issue: Issue): string {
  for (const [key, result] of Object.entries(props.report?.agentResults || {})) {
    if ((result.issues || []).some(i => i.message === issue.message && i.line === issue.line)) {
      return dimLabels[key] || key
    }
  }
  return '—'
}

const hasAssistant = computed(() => !!props.taskId && !!props.report)
</script>

<template>
  <div class="context-panel">
    <div class="panel-head">
      <div class="tab-bar" role="tablist">
        <button
          type="button"
          class="tab-btn"
          :class="{ active: activeTab === 'issue' }"
          role="tab"
          :aria-selected="activeTab === 'issue'"
          @click="activeTab = 'issue'"
        >
          详情
        </button>
        <button
          v-if="hasAssistant"
          type="button"
          class="tab-btn"
          :class="{ active: activeTab === 'assistant' }"
          role="tab"
          :aria-selected="activeTab === 'assistant'"
          @click="activeTab = 'assistant'"
        >
          AI 助手
        </button>
        <button
          type="button"
          class="tab-btn"
          :class="{ active: activeTab === 'metrics' }"
          role="tab"
          :aria-selected="activeTab === 'metrics'"
          @click="activeTab = 'metrics'"
        >
          指标
        </button>
      </div>
      <button type="button" class="panel-close" aria-label="关闭面板" @click="emit('close')">
        ✕
      </button>
    </div>

    <div class="panel-scroll">
      <!-- 问题详情 -->
      <template v-if="activeTab === 'issue'">
        <div v-if="selectedIssue" class="issue-detail">
          <div class="detail-badges">
            <span class="sev-badge" :class="`sev-${selectedIssue.severity}`">
              {{ severityLabel(selectedIssue.severity) }}
            </span>
            <span class="dim-badge">{{ dimensionOf(selectedIssue) }}</span>
            <span class="loc-badge">第 {{ selectedIssue.line }} 行</span>
          </div>
          <div class="detail-block">
            <div class="block-label">问题描述</div>
            <p class="block-text">{{ selectedIssue.message }}</p>
          </div>
          <div class="detail-block">
            <div class="block-label">修复建议</div>
            <p class="block-text suggestion">{{ selectedIssue.suggestion }}</p>
          </div>
          <div class="detail-block">
            <div class="block-label">类别</div>
            <p class="block-text">{{ selectedIssue.category }}</p>
          </div>
        </div>
        <div v-else class="empty-hint">
          在左侧问题列表中点击任意一条，这里会显示它的完整描述与修复建议。
        </div>
      </template>

      <!-- AI 助手 -->
      <template v-else-if="activeTab === 'assistant'">
        <AssistantChat v-if="hasAssistant" :key="`assistant-${taskId}`" />
        <div v-else class="empty-hint">审查完成后可与 AI 助手追问报告细节。</div>
      </template>

      <!-- 指标 -->
      <template v-else>
        <MetricsPanel />
      </template>
    </div>
  </div>
</template>

<style scoped>
.context-panel {
  width: 344px;
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
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border-light);
}

.tab-bar {
  display: flex;
  gap: 2px;
}

.tab-btn {
  padding: 6px 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s ease;
}

.tab-btn:hover {
  color: var(--color-text);
  background: var(--color-hover-bg);
}

.tab-btn.active {
  color: var(--color-primary);
  background: var(--color-primary-light);
  font-weight: 600;
}

.panel-close {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.panel-close:hover {
  color: var(--color-text);
  background: var(--color-hover-bg);
}

.panel-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}

/* 问题详情 */
.issue-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-badges {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.sev-badge {
  font-size: 12px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 12px;
}

.sev-critical {
  background: var(--color-danger-bg);
  color: var(--color-danger-text);
}
.sev-warning {
  background: var(--color-warning-bg);
  color: var(--color-warning-text);
}
.sev-suggestion {
  background: var(--color-info-bg);
  color: var(--color-info-text);
}

.dim-badge,
.loc-badge {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 12px;
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-light);
}

.loc-badge {
  font-family: var(--font-mono);
}

.detail-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.block-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.block-text {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--color-text);
}

.block-text.suggestion {
  background: var(--color-success-bg);
  color: var(--color-success-text);
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid color-mix(in srgb, var(--color-success) 25%, transparent);
}

.empty-hint {
  font-size: 13px;
  color: var(--color-text-muted);
  line-height: 1.8;
  padding: 20px 8px;
  text-align: center;
}
</style>
