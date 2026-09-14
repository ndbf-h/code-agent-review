<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useReviewStore } from '../stores/review'
import { useChat } from '../composables/useChat'
import axios from 'axios'
import CodeInput from './CodeInput.vue'
import ChatMessage from './ChatMessage.vue'
import ReviewReport from './ReviewReport.vue'
import ProcessPanel from './ProcessPanel.vue'
import ContextPanel from './ContextPanel.vue'
import type { Issue } from '../types/index'

const store = useReviewStore()
const { startReview, retry, lastCode, lastLang } = useChat()

function onRetry() {
  retry()
}

const examples = [
  {
    lang: 'typescript',
    label: 'TypeScript',
    desc: '审查函数逻辑与类型安全',
    code: [
      'function add(a: number, b: number): number {',
      '  return a - b',
      '}',
      '',
      'function divide(a: number, b: number): number {',
      '  if (b === 0) throw new Error("Division by zero")',
      '  return a / b',
      '}'
    ].join('\n')
  },
  {
    lang: 'python',
    label: 'Python',
    desc: '审查性能与资源管理',
    code: [
      'def fibonacci(n):',
      '    if n <= 1:',
      '        return n',
      '    return fibonacci(n-1) + fibonacci(n-2)',
      '',
      'def read_file(path):',
      '    f = open(path, "r")',
      '    return f.read()'
    ].join('\n')
  },
  {
    lang: 'javascript',
    label: '快速体验',
    desc: '快速体验 AI 代码审查',
    code: 'console.log("hello world")'
  }
]

function runExample(index: number) {
  const ex = examples[index]
  if (ex) startReview(ex.code, ex.lang)
}

// ── 工作台状态 ──
const reportMsg = computed(() => store.messages.find(m => m.type === 'report' && m.report))
const hasReport = computed(() => !!reportMsg.value)

/** 是否处于任务上下文（有消息即视为有任务） */
const hasTask = computed(() => store.messages.length > 0 || store.loading)

// 过程面板：运行时默认展开，完成后自动收起（结果优先），可手动展开回看
const processCollapsed = ref(false)
watch(
  () => store.status,
  (status, prev) => {
    if ((status === 'completed' || status === 'failed') && prev && prev !== status) {
      processCollapsed.value = true
    }
  }
)

// 右栏：选中问题 / 助手 / 指标
const selectedIssue = ref<Issue | null>(null)
const rightTab = ref<'issue' | 'assistant' | 'metrics' | null>(null)

function openIssue(issue: Issue) {
  selectedIssue.value = issue
  rightTab.value = 'issue'
}

function toggleRight(tab: 'assistant' | 'metrics') {
  rightTab.value = rightTab.value === tab ? null : tab
}

function closeRight() {
  rightTab.value = null
  selectedIssue.value = null
}

const statusLabel = computed(() => {
  const map: Record<string, string> = {
    pending: '排队中',
    orchestrating: '审查中',
    reviewing: '审查中',
    summarizing: '汇总中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消'
  }
  return map[store.status] || store.status
})

/** 取消运行中/排队中的任务；终态后按钮消失 */
const cancelling = ref(false)
const cancellable = computed(
  () =>
    store.loading &&
    !hasReport.value &&
    ['pending', 'orchestrating', 'reviewing', 'summarizing'].includes(store.status)
)

async function cancelTask() {
  if (!store.taskId || cancelling.value) return
  cancelling.value = true
  try {
    const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api'
    await axios.post(`${API_BASE}/tasks/${store.taskId}/cancel`)
    // 状态更新由 SSE task_cancelled 事件驱动；这里无需改本地状态
  } catch {
    // 任务可能恰好完成（409），交给 SSE/sync 收敛
  } finally {
    cancelling.value = false
  }
}

// 运行中的过程消息（用户输入、系统事件流；报告卡片单独立渲染）
const streamMessages = computed(() => store.messages.filter(m => m.type !== 'report'))
</script>

<template>
  <div class="chat-view">
    <!-- 空态：欢迎引导（居中 hero） -->
    <div v-if="!hasTask" class="welcome-guide">
      <div class="welcome-header">
        <span class="welcome-icon">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="12" fill="url(#welcome-grad)" />
            <path
              d="M14 18l6 6-6 6"
              stroke="#fff"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M22 30l8-12"
              stroke="#fff"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <defs>
              <linearGradient id="welcome-grad" x1="0" y1="0" x2="48" y2="48">
                <stop stop-color="#3b5cf6" />
                <stop offset="1" stop-color="#8b5cf6" />
              </linearGradient>
            </defs>
          </svg>
        </span>
        <h2 class="welcome-title">欢迎使用 AI 代码审查</h2>
        <p class="welcome-desc">
          粘贴代码或输入 URL，AI 将从<span class="highlight">安全</span>、<span class="highlight"
            >性能</span
          >、<span class="highlight">规范</span>、<span class="highlight">逻辑</span
          >四个维度审查你的代码
        </p>
      </div>

      <div class="quick-start">
        <h3 class="section-label">快速开始</h3>
        <div class="example-cards">
          <div v-for="(ex, i) in examples" :key="i" class="example-card" @click="runExample(i)">
            <span class="example-lang">{{ ex.label }}</span>
            <span class="example-desc">{{ ex.desc }}</span>
            <span class="example-arrow">→</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 工作台三区：过程（左） | 内容（中） | 上下文（右） -->
    <div v-else class="workbench">
      <!-- 左：执行过程 -->
      <ProcessPanel :collapsed="processCollapsed" />

      <!-- 中：状态栏 + 内容 -->
      <section class="wb-center">
        <div class="wb-statusbar">
          <span class="status-badge" :class="`st-${store.status}`">
            <span class="status-dot" :class="{ pulse: store.loading }"></span>
            {{ statusLabel }}
          </span>
          <div class="statusbar-actions">
            <button
              v-if="cancellable"
              type="button"
              class="sb-btn cancel"
              :disabled="cancelling"
              :title="cancelling ? '取消中...' : '终止当前审查任务'"
              @click="cancelTask"
            >
              {{ cancelling ? '取消中...' : '✕ 取消' }}
            </button>
            <button
              type="button"
              class="sb-btn"
              :class="{ active: !processCollapsed }"
              :title="processCollapsed ? '展开执行过程' : '收起执行过程'"
              @click="processCollapsed = !processCollapsed"
            >
              过程
            </button>
            <button
              v-if="hasReport"
              type="button"
              class="sb-btn"
              :class="{ active: rightTab === 'assistant' }"
              @click="toggleRight('assistant')"
            >
              AI 助手
            </button>
            <button
              v-if="hasReport"
              type="button"
              class="sb-btn"
              :class="{ active: rightTab === 'metrics' }"
              @click="toggleRight('metrics')"
            >
              指标
            </button>
          </div>
        </div>

        <div class="wb-scroll">
          <!-- 结果优先：报告就绪后主栏即报告 -->
          <ReviewReport
            v-if="hasReport && reportMsg?.report"
            :report="reportMsg.report"
            :code="lastCode"
            :language="lastLang"
            :selected-line="selectedIssue?.line ?? null"
            @select-issue="openIssue"
          />

          <!-- 运行中：过程事件流 -->
          <template v-else>
            <div v-for="msg in streamMessages" :key="msg.id" class="stream-row">
              <ChatMessage
                :message="msg"
                :on-retry="
                  msg.role === 'system' && msg.content.startsWith('错误：') ? onRetry : undefined
                "
              />
            </div>
            <div v-if="store.loading" class="loading-indicator">
              <span class="loading-dot"></span>
              <span class="loading-dot"></span>
              <span class="loading-dot"></span>
              <span class="loading-hint">左侧面板可查看各 Agent 实时进度</span>
            </div>
          </template>
        </div>

        <div class="wb-input">
          <CodeInput :disabled="store.loading" @submit="startReview" />
        </div>
      </section>

      <!-- 右：上下文面板（宽屏常驻 / 窄屏覆盖抽屉，均由 CSS 控制） -->
      <ContextPanel
        v-if="rightTab"
        class="wb-context"
        :task-id="store.taskId"
        :report="reportMsg?.report || null"
        :selected-issue="selectedIssue"
        :code="lastCode"
        :language="lastLang"
        @close="closeRight"
      />
    </div>

    <!-- 空态下的输入区 -->
    <div v-if="!hasTask" class="input-area">
      <CodeInput :disabled="store.loading" @submit="startReview" />
    </div>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
  min-height: 460px;
}

/* ── 工作台三区 ── */
.workbench {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 14px;
}

.wb-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wb-statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-border);
}

.st-pending .status-dot {
  background: var(--color-warning);
}
.st-orchestrating .status-dot,
.st-reviewing .status-dot,
.st-summarizing .status-dot {
  background: var(--color-primary);
}
.st-completed .status-dot {
  background: var(--color-success);
}
.st-failed .status-dot,
.st-cancelled .status-dot {
  background: var(--color-danger);
}

.sb-btn.cancel {
  color: var(--color-danger-text);
  border-color: var(--color-danger);
  background: var(--color-danger-bg);
}

.sb-btn.cancel:hover {
  color: #fff;
  background: var(--color-danger);
}

.status-dot.pulse {
  animation: pulse-dot 1.4s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%,
  100% {
    opacity: 0.4;
    transform: scale(0.85);
  }
  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}

.statusbar-actions {
  display: flex;
  gap: 6px;
}

.sb-btn {
  padding: 5px 12px;
  border: 1px solid var(--color-border-light);
  border-radius: 16px;
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s ease;
}

.sb-btn:hover {
  color: var(--color-primary);
  border-color: var(--color-primary);
}

.sb-btn.active {
  color: var(--color-primary);
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

.wb-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}

.wb-input {
  flex-shrink: 0;
}

/* ── 窄屏：左右面板转覆盖抽屉 ── */
@media (max-width: 1280px) {
  .wb-context {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 200;
    border-radius: var(--radius-lg) 0 0 var(--radius-lg);
    box-shadow: var(--shadow-xl);
    background: var(--color-bg);
  }
}

@media (max-width: 900px) {
  .chat-view {
    height: auto;
    min-height: calc(100vh - 120px);
  }

  .workbench {
    flex-direction: column;
  }

  .workbench > :first-child {
    width: auto;
  }

  .wb-center {
    order: -1;
  }
}

/* ── 空态欢迎引导 ── */
.welcome-guide {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 0 4px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.welcome-header {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.welcome-icon svg {
  display: block;
}

.welcome-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text);
  letter-spacing: -0.5px;
  margin: 0;
}

.welcome-desc {
  font-size: 15px;
  color: var(--color-text-secondary);
  line-height: 1.8;
  max-width: 480px;
  margin: 0;
}

.welcome-desc .highlight {
  color: var(--color-primary);
  font-weight: 600;
}

.section-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin: 0 0 12px;
}

.quick-start {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
}

.example-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.example-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  padding: 16px 18px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: all 0.15s ease;
  position: relative;
}

.example-card:hover {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(59, 92, 246, 0.06);
  transform: translateY(-1px);
}

.example-lang {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.example-desc {
  font-size: 12px;
  color: var(--color-text-muted);
}

.example-arrow {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 16px;
  color: var(--color-text-muted);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.example-card:hover .example-arrow {
  opacity: 1;
  color: var(--color-primary);
}

/* ── 输入区 ── */
.input-area {
  flex-shrink: 0;
  padding-top: 16px;
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
}

/* ── 运行中加载指示 ── */
.loading-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 20px 24px;
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}

.loading-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-primary);
  animation: bounce 1.2s ease-in-out infinite;
}

.loading-dot:nth-child(2) {
  animation-delay: 0.15s;
}
.loading-dot:nth-child(3) {
  animation-delay: 0.3s;
}

.loading-hint {
  margin-left: 8px;
  font-size: 12.5px;
  color: var(--color-text-muted);
}

@keyframes bounce {
  0%,
  80%,
  100% {
    opacity: 0.2;
    transform: translateY(0);
  }
  40% {
    opacity: 1;
    transform: translateY(-6px);
  }
}

@media (max-width: 640px) {
  .example-cards {
    grid-template-columns: 1fr;
  }
}
</style>
