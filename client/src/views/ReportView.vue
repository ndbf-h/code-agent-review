<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import MarkdownIt from 'markdown-it'
import type { FixResult, Issue, ReviewReport, Severity, TaskStatus } from '../types/index'
import CodeDiff from '../components/CodeDiff.vue'

const route = useRoute()
const router = useRouter()
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api'

const taskId = computed(() => route.params.id as string)

interface TaskDetail {
  id: string
  title: string
  codeSnippet: string
  language: string
  status: TaskStatus
  createdAt: string
}

type IssueFilter = 'all' | Severity
type DimensionFilter = 'all' | string

const task = ref<TaskDetail | null>(null)
const reportData = ref<ReviewReport | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const activeSeverity = ref<IssueFilter>('all')
const activeDimension = ref<DimensionFilter>('all')

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
})

function renderMd(text: string): string {
  return md.render(text || '')
}

async function fetchReport() {
  loading.value = true
  error.value = null
  try {
    const res = await axios.get(`${API_BASE}/tasks/${taskId.value}`)
    const data = res.data as {
      task: TaskDetail
      report: { content: ReviewReport; score: number } | null
    }
    task.value = data.task
    reportData.value = data.report?.content || null
  } catch (err) {
    error.value = axios.isAxiosError(err) && err.response?.data?.error
      ? err.response.data.error
      : '加载报告失败，请稍后重试。'
  } finally {
    loading.value = false
  }
}

function getSeverityLabel(severity: string): string {
  const map: Record<string, string> = {
    critical: '高危',
    warning: '警告',
    suggestion: '建议'
  }
  return map[severity] || severity
}

function getSeverityHint(severity: Severity): string {
  const map: Record<Severity, string> = {
    critical: '需要优先修复',
    warning: '建议排期处理',
    suggestion: '可持续优化'
  }
  return map[severity]
}

function getScoreColor(score: number): string {
  if (score >= 80) return 'var(--color-success-text)'
  if (score >= 60) return 'var(--color-warning-text)'
  return 'var(--color-danger-text)'
}

function getScoreLabel(score: number): string {
  if (score >= 90) return '优秀'
  if (score >= 80) return '良好'
  if (score >= 60) return '一般'
  if (score >= 40) return '较差'
  return '高风险'
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${h}:${min}`
}

const counts = computed(() => {
  const result: Record<Severity, number> = { critical: 0, warning: 0, suggestion: 0 }
  reportData.value?.issues.forEach(issue => {
    result[issue.severity] += 1
  })
  return result
})

const dimLabels: Record<string, string> = {
  security: '安全',
  performance: '性能',
  style: '规范',
  logic: '逻辑'
}

const dimensions = computed(() => {
  const report = reportData.value
  if (!report) return []
  return Object.entries(report.agentResults || {}).map(([key, val]) => ({
    key,
    label: dimLabels[key] || key,
    score: val.score || 0,
    issues: (val.issues || []) as Issue[]
  }))
})

const filteredIssues = computed(() => {
  const report = reportData.value
  if (!report) return []
  let issues = report.issues

  if (activeDimension.value !== 'all') {
    issues = report.agentResults[activeDimension.value]?.issues || []
  }

  if (activeSeverity.value !== 'all') {
    issues = issues.filter(issue => issue.severity === activeSeverity.value)
  }

  return issues
})

const totalIssues = computed(() => reportData.value?.issues.length || 0)

const topIssue = computed(() => {
  const priority: Record<Severity, number> = { critical: 0, warning: 1, suggestion: 2 }
  return [...(reportData.value?.issues || [])].sort((a, b) => priority[a.severity] - priority[b.severity])[0]
})

const codeStats = computed(() => {
  const code = task.value?.codeSnippet || ''
  const lines = code ? code.split('\n').length : 0
  const chars = code.length
  return { lines, chars }
})

const isFixing = ref(false)
const fixResult = ref<FixResult | null>(null)
const fixError = ref('')

async function requestFix() {
  if (!task.value?.codeSnippet || !task.value?.language) return
  isFixing.value = true
  fixError.value = ''
  fixResult.value = null
  try {
    const { data } = await axios.post(`${API_BASE}/tasks/${taskId.value}/fix`, {
      code: task.value.codeSnippet,
      language: task.value.language
    })
    fixResult.value = data as FixResult
    const count = data.changes?.length || 0
    ElMessage.success(count === 0 ? '当前代码无需自动修复' : `已生成 ${count} 处修复建议`)
  } catch (err) {
    fixError.value = axios.isAxiosError(err) && err.response?.data?.error
      ? err.response.data.error
      : '修复请求失败，请检查网络后重试。'
  } finally {
    isFixing.value = false
  }
}

onMounted(() => {
  fetchReport()
})
</script>

<template>
  <div class="report-page">
    <div v-if="loading" class="loading-panel">
      <div class="skeleton-score"></div>
      <div class="skeleton-line w-64"></div>
      <div class="skeleton-line w-42"></div>
    </div>

    <section v-else-if="error" class="state-panel">
      <p class="state-title">加载失败</p>
      <p class="state-desc">{{ error }}</p>
      <div class="state-actions">
        <el-button size="small" @click="router.push({ name: 'history' })">返回历史</el-button>
        <el-button type="primary" size="small" @click="fetchReport">重试</el-button>
      </div>
    </section>

    <section v-else-if="!reportData" class="state-panel">
      <p class="state-title">报告尚未生成</p>
      <p class="state-desc">
        当前任务状态为 {{ task ? task.status : 'unknown' }}，可以稍后刷新查看。
      </p>
      <div class="state-actions">
        <el-button size="small" @click="router.push({ name: 'history' })">返回历史</el-button>
        <el-button type="primary" size="small" @click="fetchReport">刷新</el-button>
      </div>
    </section>

    <template v-else>
      <div class="top-nav">
        <el-button text size="small" @click="router.push({ name: 'history' })">
          返回历史
        </el-button>
        <el-button size="small" @click="fetchReport">刷新报告</el-button>
      </div>

      <section class="report-hero">
        <div class="score-block" :style="{ '--score-color': getScoreColor(reportData.score) }">
          <span class="score-value">{{ reportData.score }}</span>
          <span class="score-label">/100</span>
        </div>
        <div class="hero-main">
          <p class="eyebrow">Review Report</p>
          <h1>{{ getScoreLabel(reportData.score) }}，发现 {{ totalIssues }} 个问题</h1>
          <p v-if="task" class="hero-meta">
            {{ task.title }} · {{ task.language }} · {{ formatDate(task.createdAt) }}
          </p>
          <p v-if="topIssue" class="hero-focus">
            优先关注：L{{ topIssue.line }} {{ topIssue.message }}
          </p>
        </div>
      </section>

      <section class="summary-grid">
        <div class="summary-card critical">
          <span>高危</span>
          <strong>{{ counts.critical }}</strong>
        </div>
        <div class="summary-card warning">
          <span>警告</span>
          <strong>{{ counts.warning }}</strong>
        </div>
        <div class="summary-card suggestion">
          <span>建议</span>
          <strong>{{ counts.suggestion }}</strong>
        </div>
        <div class="summary-card neutral">
          <span>代码规模</span>
          <strong>{{ codeStats.lines }}</strong>
          <small>{{ codeStats.chars }} chars</small>
        </div>
      </section>

      <section v-if="dimensions.length > 0" class="section-block">
        <div class="section-head">
          <h2>维度评分</h2>
          <span>多 Agent 审查结果</span>
        </div>
        <div class="dimension-grid">
          <button
            v-for="dim in dimensions"
            :key="dim.key"
            class="dimension-card"
            type="button"
            :class="{ active: activeDimension === dim.key }"
            @click="activeDimension = activeDimension === dim.key ? 'all' : dim.key"
          >
            <span class="dimension-top">
              <span>{{ dim.label }}</span>
              <strong :style="{ color: getScoreColor(dim.score) }">{{ dim.score }}</strong>
            </span>
            <span class="dimension-bar">
              <span
                class="dimension-fill"
                :style="{ width: `${dim.score}%`, background: getScoreColor(dim.score) }"
              ></span>
            </span>
            <span class="dimension-foot">{{ dim.issues.length }} 个问题</span>
          </button>
        </div>
      </section>

      <section class="section-block">
        <div class="section-head issue-head">
          <div>
            <h2>问题列表</h2>
            <span>{{ filteredIssues.length }} 个匹配结果</span>
          </div>
          <div class="filters">
            <button
              class="filter-btn"
              :class="{ active: activeSeverity === 'all' }"
              @click="activeSeverity = 'all'"
            >
              全部
            </button>
            <button
              v-for="severity in ['critical', 'warning', 'suggestion'] as Severity[]"
              :key="severity"
              class="filter-btn"
              :class="{ active: activeSeverity === severity }"
              @click="activeSeverity = severity"
            >
              {{ getSeverityLabel(severity) }}
            </button>
          </div>
        </div>

        <div class="issue-list">
          <article
            v-for="(issue, index) in filteredIssues"
            :key="`${issue.line}-${issue.category}-${index}`"
            class="issue-card"
            :class="`issue-${issue.severity}`"
          >
            <div class="issue-top">
              <span class="severity-pill" :class="`sev-${issue.severity}`">
                {{ getSeverityLabel(issue.severity) }}
              </span>
              <span class="issue-category">{{ issue.category }}</span>
              <span class="issue-line">L{{ issue.line }}</span>
            </div>
            <div class="issue-message" v-html="renderMd(issue.message)"></div>
            <div class="suggestion-box">
              <span>{{ getSeverityHint(issue.severity) }}</span>
              <div v-html="renderMd(issue.suggestion)"></div>
            </div>
          </article>

          <div v-if="filteredIssues.length === 0" class="inline-empty">
            当前筛选条件下没有问题。
          </div>
        </div>
      </section>

      <section v-if="task?.codeSnippet && task?.language" class="section-block fix-section">
        <div class="section-head issue-head">
          <div>
            <h2>自动修复</h2>
            <span>根据报告问题生成修复后的代码对比</span>
          </div>
          <el-button
            type="warning"
            :loading="isFixing"
            :disabled="isFixing || totalIssues === 0"
            @click="requestFix"
          >
            {{ isFixing ? '生成中...' : '生成修复建议' }}
          </el-button>
        </div>

        <el-alert
          v-if="fixError"
          :title="fixError"
          type="error"
          show-icon
          closable
          @close="fixError = ''"
        />

        <CodeDiff
          v-if="fixResult"
          :original-code="fixResult.originalCode"
          :fixed-code="fixResult.fixedCode"
          :changes="fixResult.changes"
          :language="task.language"
        />
      </section>
    </template>
  </div>
</template>

<style scoped>
.report-page {
  max-width: 1400px;
  margin: 0 auto;
}

.top-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.report-hero {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  gap: 24px;
  align-items: center;
  padding: 26px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  margin-bottom: 16px;
}

.score-block {
  --score-color: #059669;
  width: 112px;
  height: 112px;
  border-radius: 50%;
  border: 8px solid color-mix(in srgb, var(--score-color) 24%, var(--color-border-light));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--score-color) 8%, var(--color-surface));
}

.score-value {
  color: var(--score-color);
  font-family: var(--font-mono);
  font-size: 34px;
  font-weight: 800;
  line-height: 1;
}

.score-label {
  color: var(--color-text-muted);
  font-size: 12px;
}

.eyebrow {
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 700;
  margin: 0 0 4px;
}

h1 {
  margin: 0;
  font-size: 28px;
  line-height: 1.25;
  color: var(--color-text);
}

.hero-meta,
.hero-focus {
  margin: 8px 0 0;
  color: var(--color-text-secondary);
  font-size: 14px;
}

.hero-focus {
  color: var(--color-text);
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}

.summary-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.summary-card span,
.summary-card small {
  color: var(--color-text-muted);
  font-size: 12px;
}

.summary-card strong {
  font-size: 26px;
  line-height: 1;
  font-family: var(--font-mono);
}

.summary-card.critical strong { color: var(--color-danger-text); }
.summary-card.warning strong { color: var(--color-warning-text); }
.summary-card.suggestion strong { color: var(--color-info-text); }
.summary-card.neutral strong { color: var(--color-text); }

.section-block {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 20px;
  margin-bottom: 16px;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  margin-bottom: 16px;
}

.section-head h2 {
  margin: 0;
  font-size: 17px;
  color: var(--color-text);
}

.section-head span {
  color: var(--color-text-muted);
  font-size: 13px;
}

.issue-head {
  align-items: center;
}

.dimension-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.dimension-card {
  border: 1px solid var(--color-border-light);
  background: var(--color-surface-2);
  border-radius: var(--radius-sm);
  padding: 14px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.14s ease, background 0.14s ease;
}

.dimension-card:hover,
.dimension-card.active {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

.dimension-top,
.dimension-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dimension-top span {
  color: var(--color-text);
  font-size: 13px;
  font-weight: 700;
}

.dimension-top strong {
  font-family: var(--font-mono);
  font-size: 22px;
}

.dimension-bar {
  display: block;
  height: 6px;
  background: var(--color-border-light);
  border-radius: 999px;
  overflow: hidden;
  margin: 10px 0 8px;
}

.dimension-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
}

.dimension-foot {
  color: var(--color-text-muted);
  font-size: 12px;
}

.filters {
  display: flex;
  gap: 6px;
  padding: 4px;
  background: var(--color-segmented-bg);
  border-radius: var(--radius-sm);
}

.filter-btn {
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.filter-btn.active {
  background: var(--color-surface);
  color: var(--color-primary);
  box-shadow: var(--shadow-sm);
}

.issue-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.issue-card {
  border: 1px solid var(--color-border-light);
  border-left-width: 4px;
  border-radius: var(--radius-sm);
  padding: 16px;
  background: var(--color-surface-2);
}

.issue-critical { border-left-color: var(--color-danger); }
.issue-warning { border-left-color: var(--color-warning); }
.issue-suggestion { border-left-color: var(--color-info); }

.issue-top {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.severity-pill {
  font-size: 12px;
  font-weight: 800;
  padding: 3px 10px;
  border-radius: 999px;
  white-space: nowrap;
}

.sev-critical { color: var(--color-danger-text); background: var(--color-danger-bg); }
.sev-warning { color: var(--color-warning-text); background: var(--color-warning-bg); }
.sev-suggestion { color: var(--color-info-text); background: var(--color-info-bg); }

.issue-category {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 700;
  min-width: 0;
  flex: 1;
}

.issue-line {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 12px;
}

.issue-message {
  color: var(--color-text);
  font-size: 14px;
  line-height: 1.7;
}

.issue-message :deep(p),
.suggestion-box :deep(p) {
  margin: 0;
}

.issue-message :deep(code),
.suggestion-box :deep(code) {
  background: var(--color-code-bg);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 2px 5px;
}

.suggestion-box {
  margin-top: 12px;
  padding: 12px;
  border-radius: var(--radius-sm);
  background: var(--color-success-bg);
  color: var(--color-success-text);
  font-size: 13px;
  line-height: 1.6;
}

.suggestion-box > span {
  display: block;
  font-weight: 800;
  margin-bottom: 4px;
}

.fix-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.state-panel,
.loading-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 56px 24px;
  text-align: center;
}

.state-title {
  font-size: 18px;
  font-weight: 800;
  color: var(--color-text);
  margin: 0;
}

.state-desc {
  color: var(--color-text-secondary);
  margin: 8px auto 16px;
  max-width: 420px;
}

.state-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
}

.loading-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.skeleton-score {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: linear-gradient(90deg, var(--color-skeleton-from) 25%, var(--color-skeleton-to) 50%, var(--color-skeleton-from) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.2s ease-in-out infinite;
}

.skeleton-line {
  height: 12px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--color-skeleton-from) 25%, var(--color-skeleton-to) 50%, var(--color-skeleton-from) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.2s ease-in-out infinite;
}

.w-64 { width: 64%; }
.w-42 { width: 42%; }

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.inline-empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 14px;
}

@media (max-width: 820px) {
  .report-hero {
    grid-template-columns: 1fr;
  }

  .summary-grid,
  .dimension-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .issue-head {
    align-items: stretch;
    flex-direction: column;
  }

  .filters {
    overflow-x: auto;
  }
}

@media (max-width: 520px) {
  .summary-grid,
  .dimension-grid {
    grid-template-columns: 1fr;
  }

  h1 {
    font-size: 23px;
  }

  .section-block,
  .report-hero {
    padding: 16px;
  }
}
</style>
