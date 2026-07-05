<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ReviewReport as ReviewReportType, Issue } from '../types/index'

const props = defineProps<{
  report: ReviewReportType
}>()

const expandedIssue = ref<number | null>(null)

function getSeverityLabel(severity: string): string {
  const map: Record<string, string> = { critical: '高危', warning: '警告', suggestion: '建议' }
  return map[severity] || severity
}

function getSeverityClass(severity: string): string {
  return `sev-${severity}`
}

function getScoreColor(score: number): string {
  if (score >= 80) return '#10b981'
  if (score >= 60) return '#f59e0b'
  return '#ef4444'
}

function getScoreLabel(score: number): string {
  if (score >= 80) return '良好'
  if (score >= 60) return '一般'
  return '较差'
}

const counts = computed(() => {
  const c = { critical: 0, warning: 0, suggestion: 0 }
  props.report.issues.forEach(i => {
    if (i.severity in c) c[i.severity as keyof typeof c]++
  })
  return c
})

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

function toggleIssue(idx: number) {
  expandedIssue.value = expandedIssue.value === idx ? null : idx
}

// group issues by agent dimension
const dimLabels: Record<string, string> = {
  security: '安全', performance: '性能', style: '规范', logic: '逻辑'
}

const dimensions = computed(() => {
  const result: { key: string; label: string; score: number; issues: Issue[] }[] = []
  for (const [key, val] of Object.entries(props.report.agentResults)) {
    result.push({
      key,
      label: dimLabels[key] || key,
      score: val.score || 0,
      issues: (val.issues || []) as Issue[]
    })
  }
  return result
})

const expandedDim = ref<string | null>(null)

function toggleDim(key: string) {
  expandedDim.value = expandedDim.value === key ? null : key
}
</script>

<template>
  <div class="review-report">
    <!-- 1. Compact Score Bar -->
    <div class="score-bar">
      <div class="score-ring" :style="{ '--score-color': getScoreColor(report.score) }">
        <span class="score-num">{{ report.score }}</span>
        <span class="score-max">/100</span>
      </div>
      <div class="score-info">
        <span class="score-label">{{ getScoreLabel(report.score) }}</span>
        <span class="score-counts">
          高危 {{ counts.critical }} · 警告 {{ counts.warning }} · 建议 {{ counts.suggestion }}
        </span>
      </div>
    </div>

    <!-- 2. Issue List (compact) -->
    <div v-if="report.issues.length > 0" class="issue-list">
      <div class="section-label">发现 {{ report.issues.length }} 个问题</div>
      <div
        v-for="(issue, idx) in report.issues"
        :key="idx"
        class="issue-row"
        :class="{ expanded: expandedIssue === idx }"
        @click="toggleIssue(idx)"
      >
        <span class="issue-sev" :class="getSeverityClass(issue.severity)">
          {{ getSeverityLabel(issue.severity) }}
        </span>
        <span class="issue-loc">L{{ issue.line }}</span>
        <span class="issue-cat">{{ issue.category }}</span>
        <span class="issue-msg">
          {{ expandedIssue === idx ? issue.message : truncate(issue.message, 50) }}
        </span>
        <span class="issue-expand">{{ expandedIssue === idx ? '▴' : '▾' }}</span>
        <div v-if="expandedIssue === idx" class="issue-detail">
          <span class="detail-label">建议：</span>{{ issue.suggestion }}
        </div>
      </div>
    </div>

    <!-- 3. Dimension Score Cards -->
    <div v-if="dimensions.length > 0" class="dim-section">
      <div class="section-label">各维度评分</div>
      <div class="dim-grid">
        <div
          v-for="dim in dimensions"
          :key="dim.key"
          class="dim-card"
          :class="{ open: expandedDim === dim.key }"
          @click="toggleDim(dim.key)"
        >
          <div class="dim-header">
            <span class="dim-label">{{ dim.label }}</span>
            <span class="dim-score" :style="{ color: getScoreColor(dim.score) }">{{ dim.score }}</span>
            <span class="dim-arrow">{{ expandedDim === dim.key ? '▴' : '▾' }}</span>
          </div>
          <div v-if="expandedDim === dim.key && dim.issues.length > 0" class="dim-issues">
            <div v-for="(iss, i) in dim.issues" :key="i" class="dim-issue">
              <span class="issue-sev small" :class="getSeverityClass(iss.severity)">
                {{ getSeverityLabel(iss.severity) }}
              </span>
              <span class="dim-issue-msg">{{ truncate(iss.message, 60) }}</span>
            </div>
          </div>
          <div v-if="expandedDim === dim.key && dim.issues.length === 0" class="dim-empty">
            未发现明显问题
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.review-report {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 20px;
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* ── Score Bar ── */
.score-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-border-light);
}

.score-ring {
  --score-color: #10b981;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 3px solid var(--score-color);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--score-color) 6%, transparent);
}

.score-num {
  font-size: 20px;
  font-weight: 700;
  color: var(--score-color);
  line-height: 1;
}

.score-max {
  font-size: 10px;
  color: var(--color-text-muted);
  margin-top: 1px;
}

.score-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.score-label {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text);
}

.score-counts {
  font-size: 12px;
  color: var(--color-text-secondary);
}

/* ── Section Label ── */
.section-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

/* ── Issue List ── */
.issue-list {
  display: flex;
  flex-direction: column;
}

.issue-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  flex-wrap: wrap;
  transition: background 0.12s ease;
  border-bottom: 1px solid var(--color-border-light);
}

.issue-row:last-child {
  border-bottom: none;
}

.issue-row:hover {
  background: #f8f9fc;
}

.issue-row.expanded {
  background: #f8f9fc;
}

.issue-sev {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
  flex-shrink: 0;
}

.sev-critical { background: #fef2f2; color: #dc2626; }
.sev-warning { background: #fffbeb; color: #d97706; }
.sev-suggestion { background: #eff6ff; color: #2563eb; }

.issue-sev.small {
  padding: 1px 6px;
  font-size: 10px;
}

.issue-loc {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.issue-cat {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}

.issue-msg {
  font-size: 13px;
  color: var(--color-text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.issue-row.expanded .issue-msg {
  white-space: normal;
  flex-basis: 100%;
  order: 1;
}

.issue-expand {
  font-size: 10px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.issue-detail {
  width: 100%;
  font-size: 13px;
  color: #059669;
  padding: 6px 0 2px;
  border-top: 1px dashed var(--color-border-light);
  margin-top: 4px;
  line-height: 1.6;
}

.detail-label {
  font-weight: 600;
}

/* ── Dimension Section ── */
.dim-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.dim-card {
  background: #fafbfc;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.dim-card:hover {
  border-color: var(--color-border);
  box-shadow: var(--shadow-sm);
}

.dim-card.open {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

.dim-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dim-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  flex: 1;
}

.dim-score {
  font-size: 18px;
  font-weight: 700;
}

.dim-arrow {
  font-size: 10px;
  color: var(--color-text-muted);
}

.dim-issues {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.dim-issue {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.dim-issue-msg {
  color: var(--color-text-secondary);
  flex: 1;
}

.dim-empty {
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-text-muted);
  font-style: italic;
}

@media (max-width: 500px) {
  .dim-grid {
    grid-template-columns: 1fr;
  }
}
</style>
