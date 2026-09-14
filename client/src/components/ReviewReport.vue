<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { useReviewStore } from '../stores/review'
import type { ReviewReport as ReviewReportType, Issue, FixResult } from '../types/index'
import CodeDiff from './CodeDiff.vue'

const props = defineProps<{
  report: ReviewReportType
  code?: string
  language?: string
  /** 外部（右栏详情）已选中的问题，用于高亮行 */
  selectedLine?: number | null
}>()

const emit = defineEmits<{
  (e: 'select-issue', issue: Issue): void
}>()

const router = useRouter()
const store = useReviewStore()

function viewFullReport() {
  if (store.taskId) {
    router.push({ name: 'report', params: { id: store.taskId } })
  }
}

function getSeverityLabel(severity: string): string {
  const map: Record<string, string> = { critical: '高危', warning: '警告', suggestion: '建议' }
  return map[severity] || severity
}

function getSeverityClass(severity: string): string {
  return `sev-${severity}`
}

function getScoreColor(score: number): string {
  if (score >= 80) return 'var(--color-success-text)'
  if (score >= 60) return 'var(--color-warning-text)'
  return 'var(--color-danger-text)'
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

// ── 图块即筛选器（SonarQube 模式）：点击严重度/维度图块过滤下方问题列表 ──
const activeSeverity = ref<string>('all')
const activeDimension = ref<string>('all')

function toggleSeverity(sev: string) {
  activeSeverity.value = activeSeverity.value === sev ? 'all' : sev
}

function toggleDimension(key: string) {
  activeDimension.value = activeDimension.value === key ? 'all' : key
}

const dimLabels: Record<string, string> = {
  security: '安全',
  performance: '性能',
  style: '规范',
  logic: '逻辑'
}

/** issue → 维度 key 的映射（用于维度图块筛选与徽章展示） */
const issueDimension = computed(() => {
  const map = new Map<Issue, string>()
  for (const [key, result] of Object.entries(props.report.agentResults || {})) {
    for (const issue of (result.issues || []) as Issue[]) {
      if (!map.has(issue)) map.set(issue, key)
    }
  }
  return map
})

const filteredIssues = computed(() =>
  props.report.issues.filter(issue => {
    if (activeSeverity.value !== 'all' && issue.severity !== activeSeverity.value) return false
    if (
      activeDimension.value !== 'all' &&
      issueDimension.value.get(issue) !== activeDimension.value
    )
      return false
    return true
  })
)

const dimensions = computed(() => {
  const result: { key: string; label: string; score: number; issueCount: number }[] = []
  for (const [key, val] of Object.entries(props.report.agentResults)) {
    result.push({
      key,
      label: dimLabels[key] || key,
      score: val.score || 0,
      issueCount: (val.issues || []).length
    })
  }
  return result
})

function onSelectIssue(issue: Issue) {
  emit('select-issue', issue)
}

const animatedScore = ref(0)

onMounted(() => {
  const target = props.report.score
  const duration = 800
  const start = performance.now()
  function animate(now: number) {
    const elapsed = now - start
    const progress = Math.min(elapsed / duration, 1)
    const eased = 1 - Math.pow(1 - progress, 3) // ease-out cubic
    animatedScore.value = Math.round(eased * target)
    if (progress < 1) {
      requestAnimationFrame(animate)
    }
  }
  requestAnimationFrame(animate)
})

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

// ── 一键修复 ──
const isFixing = ref(false)
const fixResult = ref<FixResult | null>(null)
const fixError = ref('')

async function requestFix() {
  if (!props.code || !props.language || !store.taskId) return
  isFixing.value = true
  fixError.value = ''
  fixResult.value = null
  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api'
  try {
    const { data } = await axios.post(`${API_BASE}/tasks/${store.taskId}/fix`, {
      code: props.code,
      language: props.language
    })
    fixResult.value = data as FixResult
    if (data.changes && data.changes.length === 0) {
      ElMessage.success('代码已是最佳状态 ✅')
    } else {
      ElMessage.success(`已修复 ${data.changes?.length || 0} 处问题`)
    }
  } catch (err) {
    const message =
      axios.isAxiosError(err) && err.response?.data?.error
        ? err.response.data.error
        : '修复请求失败，请检查网络后重试'
    fixError.value = message
  } finally {
    isFixing.value = false
  }
}
</script>

<template>
  <div class="review-report">
    <!-- 0. 输入安全提示（REQ-10）：命中疑似注入时提示结论的可信边界 -->
    <div v-if="report.security?.injectionSuspected" class="security-banner" role="alert">
      <div class="banner-head">
        <span class="banner-icon" aria-hidden="true">!</span>
        <span class="banner-title">检测到疑似提示注入内容</span>
      </div>
      <p class="banner-text">
        被审查代码中包含试图操纵审查结论的文字，已作为数据隔离处理，未执行其中任何指令。以下结论仍建议人工复核。
      </p>
      <ul v-if="report.security.findings.length > 0" class="banner-list">
        <li
          v-for="finding in report.security.findings.slice(0, 5)"
          :key="`${finding.line}-${finding.pattern}`"
        >
          第 {{ finding.line }} 行 · {{ finding.pattern }}
        </li>
      </ul>
    </div>

    <!-- 0.1 ReAct 治理信息（REQ-11）：仅在发生工具调用、熔断或预算降级时展示 -->
    <div v-if="report.governance" class="governance-bar">
      <span class="gov-title">审查过程</span>
      <span v-if="report.governance.toolCalls > 0" class="gov-item">
        工具调用 {{ report.governance.toolCalls }} 次
      </span>
      <span v-if="report.governance.loopBreaks > 0" class="gov-item gov-warn">
        重复调用熔断 {{ report.governance.loopBreaks }} 次
      </span>
      <span v-if="report.governance.budgetExceeded" class="gov-item gov-warn">
        已触发 token 预算降级
      </span>
    </div>

    <!-- 1. 评分头 + 严重度图块（图块即筛选器） -->
    <div class="score-bar">
      <div class="score-ring" :style="{ '--score-color': getScoreColor(report.score) }">
        <span class="score-num">{{ animatedScore }}</span>
        <span class="score-max">/100</span>
      </div>
      <div class="score-info">
        <span class="score-label">{{ getScoreLabel(report.score) }}</span>
        <span class="score-sub">综合评分 · 共 {{ report.issues.length }} 个问题</span>
      </div>
      <div class="sev-tiles" role="group" aria-label="按严重度筛选">
        <button
          type="button"
          class="sev-tile critical"
          :class="{ active: activeSeverity === 'critical' }"
          @click="toggleSeverity('critical')"
        >
          <span class="tile-num">{{ counts.critical }}</span>
          <span class="tile-label">高危</span>
        </button>
        <button
          type="button"
          class="sev-tile warning"
          :class="{ active: activeSeverity === 'warning' }"
          @click="toggleSeverity('warning')"
        >
          <span class="tile-num">{{ counts.warning }}</span>
          <span class="tile-label">警告</span>
        </button>
        <button
          type="button"
          class="sev-tile suggestion"
          :class="{ active: activeSeverity === 'suggestion' }"
          @click="toggleSeverity('suggestion')"
        >
          <span class="tile-num">{{ counts.suggestion }}</span>
          <span class="tile-label">建议</span>
        </button>
        <button
          v-if="activeSeverity !== 'all'"
          type="button"
          class="sev-tile reset"
          aria-label="清除筛选"
          @click="activeSeverity = 'all'"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- 2. 维度评分 chips（点击筛选 + 展示分数） -->
    <div class="dim-chips" role="group" aria-label="按维度筛选">
      <button
        v-for="dim in dimensions"
        :key="dim.key"
        type="button"
        class="dim-chip"
        :class="{ active: activeDimension === dim.key }"
        @click="toggleDimension(dim.key)"
      >
        <span class="chip-label">{{ dim.label }}</span>
        <span class="chip-score" :style="{ color: getScoreColor(dim.score) }">{{ dim.score }}</span>
        <span v-if="dim.issueCount > 0" class="chip-count">{{ dim.issueCount }}</span>
      </button>
    </div>

    <!-- 3. 问题列表（响应图块筛选） -->
    <div v-if="filteredIssues.length > 0" class="issue-list">
      <div class="section-label">
        {{
          filteredIssues.length === report.issues.length
            ? `发现 ${report.issues.length} 个问题`
            : `筛选出 ${filteredIssues.length} / ${report.issues.length} 个问题`
        }}
        <span v-if="activeSeverity !== 'all' || activeDimension !== 'all'" class="filter-hint"
          >（点击图块可清除筛选）</span
        >
      </div>
      <div
        v-for="(issue, idx) in filteredIssues"
        :key="idx"
        class="issue-row"
        :class="{ selected: selectedLine !== null && selectedLine === issue.line }"
        role="button"
        tabindex="0"
        @click="onSelectIssue(issue)"
        @keydown.enter="onSelectIssue(issue)"
      >
        <span class="issue-sev" :class="getSeverityClass(issue.severity)">
          {{ getSeverityLabel(issue.severity) }}
        </span>
        <span class="issue-loc">L{{ issue.line }}</span>
        <span class="issue-cat">{{ issue.category }}</span>
        <span class="issue-msg" :title="issue.message">{{ truncate(issue.message, 64) }}</span>
        <span class="issue-go">›</span>
      </div>
    </div>
    <div v-else-if="report.issues.length > 0" class="issue-empty">
      当前筛选条件下没有问题，点击图块清除筛选。
    </div>

    <!-- 4. 查看完整报告 -->
    <div v-if="store.taskId" class="full-report-row">
      <el-button type="primary" text size="small" @click="viewFullReport">
        查看完整报告 &rarr;
      </el-button>
    </div>

    <!-- 5. 一键修复 -->
    <div v-if="code && language && store.taskId" class="fix-section">
      <div class="fix-divider"></div>
      <div class="fix-actions">
        <el-button type="warning" :loading="isFixing" :disabled="isFixing" @click="requestFix">
          {{ isFixing ? '修复中...' : '🔧 一键修复' }}
        </el-button>
      </div>

      <el-alert
        v-if="fixError"
        :title="fixError"
        type="error"
        show-icon
        closable
        @close="fixError = ''"
        class="fix-alert"
      >
        <template #default>
          <el-button size="small" type="primary" @click="requestFix"> 重试 </el-button>
        </template>
      </el-alert>

      <CodeDiff
        v-if="fixResult"
        :original-code="fixResult.originalCode"
        :fixed-code="fixResult.fixedCode"
        :changes="fixResult.changes"
        :language="language"
      />
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
  flex-wrap: wrap;
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

.score-sub {
  font-size: 12px;
  color: var(--color-text-secondary);
}

/* ── 严重度图块（点击筛选） ── */
.sev-tiles {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.sev-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  min-width: 56px;
  padding: 7px 10px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  cursor: pointer;
  transition: all 0.12s ease;
}

.sev-tile .tile-num {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.1;
}

.sev-tile .tile-label {
  font-size: 11px;
  color: var(--color-text-secondary);
}

.sev-tile.critical .tile-num {
  color: var(--color-danger-text);
}
.sev-tile.warning .tile-num {
  color: var(--color-warning-text);
}
.sev-tile.suggestion .tile-num {
  color: var(--color-info-text);
}

.sev-tile:hover {
  border-color: var(--color-border);
  box-shadow: var(--shadow-sm);
}

.sev-tile.critical.active {
  border-color: var(--color-danger);
  background: var(--color-danger-bg);
}
.sev-tile.warning.active {
  border-color: var(--color-warning);
  background: var(--color-warning-bg);
}
.sev-tile.suggestion.active {
  border-color: var(--color-info);
  background: var(--color-info-bg);
}

.sev-tile.reset {
  min-width: 34px;
  font-size: 13px;
  color: var(--color-text-muted);
}

/* ── 维度 chips ── */
.dim-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.dim-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--color-border-light);
  border-radius: 18px;
  background: var(--color-surface-2);
  cursor: pointer;
  font-size: 12.5px;
  transition: all 0.12s ease;
}

.dim-chip:hover {
  border-color: var(--color-border);
  box-shadow: var(--shadow-sm);
}

.dim-chip.active {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

.chip-label {
  font-weight: 600;
  color: var(--color-text);
}

.chip-score {
  font-weight: 700;
}

.chip-count {
  font-size: 11px;
  padding: 0 6px;
  border-radius: 9px;
  background: var(--color-border-light);
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

/* ── Full report link ── */
.full-report-row {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
}

/* ── Issue List ── */
.issue-list {
  display: flex;
  flex-direction: column;
}

.issue-empty {
  font-size: 13px;
  color: var(--color-text-muted);
  padding: 12px 4px;
  font-style: italic;
}

.issue-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease;
  border-bottom: 1px solid var(--color-border-light);
}

.issue-row:last-child {
  border-bottom: none;
}

.issue-row:hover {
  background: var(--color-surface-hover);
}

.issue-row.selected {
  background: var(--color-primary-light);
  box-shadow: inset 2px 0 0 var(--color-primary);
}

.issue-sev {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
  flex-shrink: 0;
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

.issue-go {
  font-size: 15px;
  color: var(--color-text-muted);
  flex-shrink: 0;
  line-height: 1;
}

.filter-hint {
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}

/* ── 一键修复 ── */
.fix-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.fix-divider {
  height: 1px;
  background: var(--color-border-light);
}

.fix-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.fix-alert {
  margin-top: 4px;
}

/* ── 输入安全提示条（REQ-10） ── */
.security-banner {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--color-warning);
  border-radius: var(--radius-md);
  background: var(--color-warning-bg);
}

.banner-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.banner-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-warning);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}

.banner-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-warning-text);
}

.banner-text {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--color-text-secondary);
}

.banner-list {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: var(--color-text-muted);
}

/* ── 治理统计条（REQ-11） ── */
.governance-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 6px 10px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  font-size: 12px;
  color: var(--color-text-secondary);
}

.gov-title {
  font-weight: 700;
  color: var(--color-text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.gov-item {
  white-space: nowrap;
}

.gov-warn {
  color: var(--color-warning-text);
  font-weight: 600;
}
</style>
