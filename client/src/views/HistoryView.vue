<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { http, isAxiosError } from '../api/http'
import type { TaskItem, TaskStatus } from '../types/index'

const router = useRouter()

const tasks = ref<TaskItem[]>([])
const total = ref(0)
const loading = ref(true)
const error = ref<string | null>(null)
const page = ref(1)
const pageSize = 10
const loadingMore = ref(false)
const activeStatus = ref<'all' | TaskStatus>('all')

const statusOptions: Array<{ value: 'all' | TaskStatus; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'pending', label: '等待中' },
  { value: 'orchestrating', label: '编排中' },
  { value: 'reviewing', label: '审查中' },
  { value: 'summarizing', label: '总结中' }
]

async function fetchTasks(isLoadMore = false) {
  if (isLoadMore) {
    loadingMore.value = true
  } else {
    loading.value = true
  }
  error.value = null

  try {
    const offset = (page.value - 1) * pageSize
    const res = await http.get('/tasks', {
      params: {
        limit: pageSize,
        offset,
        status: activeStatus.value === 'all' ? undefined : activeStatus.value
      }
    })
    const data = res.data as { tasks: TaskItem[]; total: number }

    tasks.value = isLoadMore ? [...tasks.value, ...data.tasks] : data.tasks
    total.value = data.total
  } catch (err) {
    error.value =
      isAxiosError(err) && err.response?.data?.error
        ? err.response.data.error
        : '加载历史记录失败，请检查后端服务是否正常运行。'
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function loadMore() {
  page.value += 1
  fetchTasks(true)
}

function retry() {
  page.value = 1
  fetchTasks()
}

function goToReport(id: string) {
  router.push({ name: 'report', params: { id } })
}

function getStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: '等待中',
    orchestrating: '编排中',
    reviewing: '审查中',
    summarizing: '总结中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消'
  }
  return map[status] || status
}

function getScoreTone(score: number | null): string {
  if (score === null) return 'muted'
  if (score >= 80) return 'good'
  if (score >= 60) return 'warn'
  return 'bad'
}

function getScoreLabel(score: number | null): string {
  return score === null ? '--' : String(score)
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

function codeSummary(code: string): string {
  const clean = code.trim().split('\n').find(Boolean) || '空代码片段'
  return clean.length > 96 ? `${clean.slice(0, 96)}...` : clean
}

const filteredTasks = computed(() => {
  if (activeStatus.value === 'all') return tasks.value
  return tasks.value.filter(task => task.status === activeStatus.value)
})

const completedCount = computed(
  () => tasks.value.filter(task => task.status === 'completed').length
)
const failedCount = computed(() => tasks.value.filter(task => task.status === 'failed').length)
const averageScore = computed(() => {
  const scored = tasks.value.filter(task => typeof task.score === 'number') as Array<
    TaskItem & { score: number }
  >
  if (scored.length === 0) return '--'
  const sum = scored.reduce((acc, task) => acc + task.score, 0)
  return Math.round(sum / scored.length)
})
const hasMore = computed(() => tasks.value.length < total.value)

onMounted(() => {
  fetchTasks()
})

// 状态筛选改为服务端全局过滤：切换时回到第一页重新拉取
watch(activeStatus, () => {
  page.value = 1
  fetchTasks()
})
</script>

<template>
  <div class="history-page">
    <section class="page-head">
      <div>
        <p class="eyebrow">Review History</p>
        <h1>审查任务</h1>
        <p class="subtitle">按任务状态、得分和提交时间快速回看历史审查记录。</p>
      </div>
      <el-button type="primary" @click="router.push({ name: 'home' })"> 新建审查 </el-button>
    </section>

    <section class="metric-strip">
      <div class="metric-item">
        <span class="metric-label">全部任务</span>
        <strong>{{ total }}</strong>
      </div>
      <div class="metric-item">
        <span class="metric-label">本页完成</span>
        <strong>{{ completedCount }}</strong>
      </div>
      <div class="metric-item">
        <span class="metric-label">本页失败</span>
        <strong>{{ failedCount }}</strong>
      </div>
      <div class="metric-item">
        <span class="metric-label">本页均分</span>
        <strong>{{ averageScore }}</strong>
      </div>
    </section>

    <div class="toolbar">
      <div class="segmented">
        <button
          v-for="item in statusOptions"
          :key="item.value"
          class="segment"
          :class="{ active: activeStatus === item.value }"
          @click="activeStatus = item.value"
        >
          {{ item.label }}
        </button>
      </div>
      <el-button size="small" :loading="loading" @click="retry">刷新</el-button>
    </div>

    <div v-if="loading" class="task-list" aria-label="加载中">
      <div v-for="n in 5" :key="n" class="skeleton-row">
        <div class="skeleton-line w-72"></div>
        <div class="skeleton-line w-48"></div>
        <div class="skeleton-line w-32"></div>
      </div>
    </div>

    <section v-else-if="error" class="state-panel">
      <p class="state-title">加载失败</p>
      <p class="state-desc">{{ error }}</p>
      <el-button type="primary" size="small" @click="retry">重试</el-button>
    </section>

    <section v-else-if="tasks.length === 0" class="state-panel">
      <p class="state-title">还没有审查记录</p>
      <p class="state-desc">提交一段代码后，任务历史、评分和报告入口会显示在这里。</p>
      <el-button type="primary" size="small" @click="router.push({ name: 'home' })">
        开始审查
      </el-button>
    </section>

    <section v-else class="task-list">
      <div class="list-header">
        <span>任务</span>
        <span>状态</span>
        <span>得分</span>
        <span>时间</span>
      </div>

      <button
        v-for="task in filteredTasks"
        :key="task.id"
        class="task-row"
        type="button"
        @click="goToReport(task.id)"
      >
        <span class="task-main">
          <span class="task-title">{{ task.title }}</span>
          <span class="task-code">{{ codeSummary(task.codeSnippet) }}</span>
          <span class="mobile-date">{{ formatDate(task.createdAt) }}</span>
        </span>
        <span class="status-pill" :class="`status-${task.status}`">
          {{ getStatusLabel(task.status) }}
        </span>
        <span class="score-cell" :class="`score-${getScoreTone(task.score)}`">
          {{ getScoreLabel(task.score) }}
        </span>
        <span class="task-date">{{ formatDate(task.createdAt) }}</span>
      </button>

      <div v-if="filteredTasks.length === 0" class="inline-empty">当前筛选条件下没有任务。</div>
    </section>

    <div v-if="!loading && hasMore" class="load-more">
      <el-button :loading="loadingMore" @click="loadMore">加载更多</el-button>
    </div>
  </div>
</template>

<style scoped>
.history-page {
  max-width: 1400px;
  margin: 0 auto;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 20px;
}

.eyebrow {
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  margin: 0 0 4px;
}

h1 {
  font-size: 28px;
  line-height: 1.2;
  margin: 0;
  color: var(--color-text);
}

.subtitle {
  margin: 8px 0 0;
  color: var(--color-text-secondary);
  font-size: 14px;
}

.metric-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  border-radius: var(--radius-md);
  margin-bottom: 16px;
  overflow: hidden;
}

.metric-item {
  padding: 16px 18px;
  border-right: 1px solid var(--color-border-light);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-item:last-child {
  border-right: none;
}

.metric-label {
  font-size: 12px;
  color: var(--color-text-muted);
}

.metric-item strong {
  font-size: 24px;
  line-height: 1.1;
  color: var(--color-text);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.segmented {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--color-segmented-bg);
  border-radius: var(--radius-sm);
  overflow-x: auto;
}

.segment {
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 6px;
  white-space: nowrap;
  cursor: pointer;
}

.segment.active {
  background: var(--color-surface);
  color: var(--color-primary);
  box-shadow: var(--shadow-sm);
}

.task-list {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.list-header,
.task-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 108px 72px 150px;
  align-items: center;
  gap: 16px;
}

.list-header {
  padding: 12px 18px;
  background: var(--color-table-head-bg);
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 700;
  border-bottom: 1px solid var(--color-border-light);
}

.task-row {
  width: 100%;
  text-align: left;
  border: 0;
  border-bottom: 1px solid var(--color-border-light);
  background: var(--color-surface);
  padding: 16px 18px;
  cursor: pointer;
  transition:
    background 0.14s ease,
    box-shadow 0.14s ease;
}

.task-row:last-child {
  border-bottom: none;
}

.task-row:hover {
  background: var(--color-surface-hover);
  box-shadow: inset 3px 0 0 var(--color-primary);
}

.task-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.task-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-code {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-pill {
  justify-self: start;
  font-size: 12px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 999px;
  white-space: nowrap;
}

.status-completed {
  color: var(--color-success-text);
  background: var(--color-success-bg);
}

.status-failed {
  color: var(--color-danger-text);
  background: var(--color-danger-bg);
}

.status-pending,
.status-orchestrating,
.status-reviewing,
.status-summarizing {
  color: var(--color-warning-text);
  background: var(--color-warning-bg);
}

.score-cell {
  font-family: var(--font-mono);
  font-size: 20px;
  font-weight: 800;
}

.score-good {
  color: var(--color-success-text);
}
.score-warn {
  color: var(--color-warning-text);
}
.score-bad {
  color: var(--color-danger-text);
}
.score-muted {
  color: var(--color-text-muted);
}

.task-date,
.mobile-date {
  font-size: 12px;
  color: var(--color-text-muted);
}

.mobile-date {
  display: none;
}

.state-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 56px 24px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  text-align: center;
}

.state-title {
  font-size: 17px;
  font-weight: 700;
  margin: 0;
}

.state-desc {
  color: var(--color-text-secondary);
  font-size: 14px;
  margin: 0;
  max-width: 420px;
}

.skeleton-row {
  padding: 18px;
  border-bottom: 1px solid var(--color-border-light);
}

.skeleton-line {
  height: 12px;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    var(--color-skeleton-from) 25%,
    var(--color-skeleton-to) 50%,
    var(--color-skeleton-from) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.2s ease-in-out infinite;
  margin-bottom: 10px;
}

.skeleton-line:last-child {
  margin-bottom: 0;
}

.w-72 {
  width: 72%;
}
.w-48 {
  width: 48%;
}
.w-32 {
  width: 32%;
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

.inline-empty {
  padding: 36px 18px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 14px;
}

.load-more {
  display: flex;
  justify-content: center;
  padding: 20px 0 0;
}

@media (max-width: 760px) {
  .page-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .metric-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .metric-item:nth-child(2) {
    border-right: none;
  }

  .metric-item:nth-child(-n + 2) {
    border-bottom: 1px solid var(--color-border-light);
  }

  .toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .list-header {
    display: none;
  }

  .task-row {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px 14px;
  }

  .score-cell {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: center;
  }

  .status-pill {
    grid-column: 1;
    grid-row: 2;
  }

  .task-date {
    display: none;
  }

  .mobile-date {
    display: inline;
  }
}
</style>
