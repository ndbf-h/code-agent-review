<script setup lang="ts">
import { useReviewStore } from '../stores/review'
import { useChat } from '../composables/useChat'
import CodeInput from './CodeInput.vue'
import ChatMessage from './ChatMessage.vue'
import ReviewReport from './ReviewReport.vue'
import AgentProgressPanel from './AgentProgressPanel.vue'

const store = useReviewStore()
const { startReview, retry } = useChat()

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
</script>

<template>
  <div class="chat-view">
    <div class="message-list" v-if="store.messages.length > 0 || store.loading">
      <AgentProgressPanel v-if="store.agentSlots.length > 0" />

      <template v-for="msg in store.messages" :key="msg.id">
        <ChatMessage :message="msg" :on-retry="msg.role === 'system' && msg.content.startsWith('错误：') ? onRetry : undefined" />
        <ReviewReport v-if="msg.type === 'report' && msg.report" :report="msg.report" />
      </template>

      <div v-if="store.loading" class="loading-indicator">
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
      </div>
    </div>

    <div v-else class="welcome-guide">
      <div class="welcome-header">
        <span class="welcome-icon">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="12" fill="url(#welcome-grad)"/>
            <path d="M14 18l6 6-6 6" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M22 30l8-12" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            <defs>
              <linearGradient id="welcome-grad" x1="0" y1="0" x2="48" y2="48">
                <stop stop-color="#3b5cf6"/>
                <stop offset="1" stop-color="#8b5cf6"/>
              </linearGradient>
            </defs>
          </svg>
        </span>
        <h2 class="welcome-title">欢迎使用 AI 代码审查</h2>
        <p class="welcome-desc">
          粘贴代码或输入 URL，AI 将从<span class="highlight">安全</span>、<span class="highlight">性能</span>、<span class="highlight">规范</span>、<span class="highlight">逻辑</span>四个维度审查你的代码
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

      <div class="steps">
        <h3 class="section-label">使用步骤</h3>
        <div class="step-list">
          <div class="step-item">
            <span class="step-num">1</span>
            <span>选择语言</span>
          </div>
          <div class="step-divider"></div>
          <div class="step-item">
            <span class="step-num">2</span>
            <span>粘贴代码</span>
          </div>
          <div class="step-divider"></div>
          <div class="step-item">
            <span class="step-num">3</span>
            <span>开始审查</span>
          </div>
          <div class="step-divider"></div>
          <div class="step-item">
            <span class="step-num">4</span>
            <span>查看分析</span>
          </div>
          <div class="step-divider"></div>
          <div class="step-item">
            <span class="step-num">5</span>
            <span>获取报告</span>
          </div>
        </div>
      </div>
    </div>

    <div class="input-area" :class="{ 'input-compact': store.messages.length > 0 }">
      <CodeInput :disabled="store.loading" @submit="startReview" />
    </div>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.message-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ── 空状态 ── */
.chat-view:not(:has(.message-list)) .input-area {
  padding-top: 60px;
}

/* ── 打字动画指示器 ── */
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

.loading-dot:nth-child(2) { animation-delay: 0.15s; }
.loading-dot:nth-child(3) { animation-delay: 0.3s; }

@keyframes bounce {
  0%, 80%, 100% { opacity: 0.2; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-6px); }
}

.input-area {
  padding-top: 20px;
}

.input-compact {
  padding-top: 0;
}

/* ── 欢迎引导 ── */
.welcome-guide {
  display: flex;
  flex-direction: column;
  gap: 32px;
  padding: 40px 0 20px;
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

/* ── 示例卡片 ── */
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

/* ── 使用步骤 ── */
.step-list {
  display: flex;
  align-items: center;
  gap: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.step-num {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--color-primary-light);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  flex-shrink: 0;
}

.step-divider {
  flex: 1;
  height: 1px;
  background: var(--color-border-light);
  margin: 0 12px;
  min-width: 20px;
}

@media (max-width: 640px) {
  .example-cards {
    grid-template-columns: 1fr;
  }

  .step-divider {
    display: none;
  }

  .step-list {
    flex-wrap: wrap;
    gap: 8px 4px;
    justify-content: center;
  }
}
</style>
