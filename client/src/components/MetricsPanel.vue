<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { http } from '../api/http'

interface MetricsData {
  tokenUsage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  agentLatency: {
    preScan: number
    orchestration: number
    reviewers: Record<string, number>
    reportGeneration: number
    total: number
  }
  requestCount: number
  uptime: number
}

const metrics = ref<MetricsData | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const collapsed = ref(true)

let pollTimer: ReturnType<typeof setInterval> | null = null

async function fetchMetrics() {
  try {
    loading.value = true
    error.value = null
    const res = await http.get<MetricsData>('/metrics')
    metrics.value = res.data
  } catch (err) {
    error.value = '获取 metrics 失败'
  } finally {
    loading.value = false
  }
}

function toggleCollapse() {
  collapsed.value = !collapsed.value
  if (collapsed.value) {
    stopPolling()
  } else {
    startPolling()
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(fetchMetrics, 10_000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(1)}k`
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

const dimLabels: Record<string, string> = {
  security: '安全',
  performance: '性能',
  style: '规范',
  logic: '逻辑'
}

onMounted(() => {
  fetchMetrics()
  if (!collapsed.value) startPolling()
})

onUnmounted(() => {
  stopPolling()
})
</script>

<template>
  <div class="metrics-panel" :class="{ collapsed }">
    <div class="metrics-header" @click="toggleCollapse">
      <span class="metrics-title">可观测性面板</span>
      <span class="metrics-toggle">{{ collapsed ? '展开' : '收起' }}</span>
    </div>

    <div v-if="!collapsed" class="metrics-body">
      <div v-if="loading && !metrics" class="metrics-loading">加载中...</div>
      <div v-else-if="error" class="metrics-error">{{ error }}</div>

      <template v-if="metrics">
        <!-- Token 用量 -->
        <div class="metrics-section">
          <div class="section-title">Token 用量</div>
          <div class="token-grid">
            <div class="token-item">
              <span class="token-label">Prompt</span>
              <span class="token-value">{{ formatTokens(metrics.tokenUsage.promptTokens) }}</span>
            </div>
            <div class="token-item">
              <span class="token-label">Completion</span>
              <span class="token-value">{{
                formatTokens(metrics.tokenUsage.completionTokens)
              }}</span>
            </div>
            <div class="token-item total">
              <span class="token-label">总计</span>
              <span class="token-value">{{ formatTokens(metrics.tokenUsage.totalTokens) }}</span>
            </div>
          </div>
        </div>

        <!-- Agent 延迟 -->
        <div class="metrics-section">
          <div class="section-title">Agent 延迟</div>
          <div class="latency-list">
            <div class="latency-row">
              <span class="latency-label">预扫描</span>
              <span class="latency-value">{{ formatMs(metrics.agentLatency.preScan) }}</span>
            </div>
            <div class="latency-row">
              <span class="latency-label">编排规划</span>
              <span class="latency-value">{{ formatMs(metrics.agentLatency.orchestration) }}</span>
            </div>
            <div
              v-for="(ms, role) in metrics.agentLatency.reviewers"
              :key="role"
              class="latency-row"
            >
              <span class="latency-label">{{ dimLabels[role] || role }}</span>
              <span class="latency-value">{{ formatMs(ms) }}</span>
            </div>
            <div class="latency-row">
              <span class="latency-label">报告生成</span>
              <span class="latency-value">{{
                formatMs(metrics.agentLatency.reportGeneration)
              }}</span>
            </div>
            <div class="latency-row total">
              <span class="latency-label">总耗时</span>
              <span class="latency-value">{{ formatMs(metrics.agentLatency.total) }}</span>
            </div>
          </div>
        </div>

        <!-- 服务信息 -->
        <div class="metrics-section">
          <div class="section-title">服务信息</div>
          <div class="info-row">
            <span class="info-label">运行时间</span>
            <span class="info-value">{{ formatUptime(metrics.uptime) }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">请求次数</span>
            <span class="info-value">{{ metrics.requestCount }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.metrics-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.metrics-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  cursor: pointer;
  user-select: none;
  transition: background 0.12s ease;
}

.metrics-header:hover {
  background: var(--color-surface-hover);
}

.metrics-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}

.metrics-toggle {
  font-size: 12px;
  color: var(--color-text-muted);
}

.metrics-body {
  padding: 0 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.metrics-loading,
.metrics-error {
  font-size: 12px;
  color: var(--color-text-muted);
  padding: 8px 0;
}

/* ── Section ── */
.metrics-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* ── Token Grid ── */
.token-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.token-item {
  background: var(--color-surface-2);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.token-item.total {
  background: var(--color-primary-light);
  border-color: rgba(59, 92, 246, 0.15);
}

.token-label {
  font-size: 11px;
  color: var(--color-text-muted);
}

.token-value {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text);
  font-family: var(--font-mono);
}

/* ── Latency List ── */
.latency-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.latency-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px;
  border-radius: 4px;
  background: var(--color-surface-2);
  font-size: 12px;
}

.latency-row.total {
  background: var(--color-primary-light);
  font-weight: 600;
  margin-top: 2px;
}

.latency-label {
  color: var(--color-text-secondary);
}

.latency-value {
  color: var(--color-text);
  font-family: var(--font-mono);
  font-weight: 600;
}

/* ── Info Row ── */
.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px;
  border-radius: 4px;
  background: var(--color-surface-2);
  font-size: 12px;
}

.info-label {
  color: var(--color-text-secondary);
}

.info-value {
  color: var(--color-text);
  font-family: var(--font-mono);
  font-weight: 600;
}
</style>
