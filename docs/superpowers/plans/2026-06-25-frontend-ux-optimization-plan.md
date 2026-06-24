# Frontend UX Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the frontend UX with empty-state guidance, error recovery with retry, and input interaction improvements across 6 existing files.

**Architecture:** Progressive enhancement within existing files — no new components. Infrastructure changes (useChat/useSSE retry) come first, then UI components that consume them. Independent visual changes (App.vue, CodeInput.vue) can happen in parallel.

**Tech Stack:** Vue 3 + TypeScript + Element Plus + Pinia + Vite

## Global Constraints

- No new component files — all changes within existing 6 files
- Follow existing code patterns (Composition API with `<script setup>`, scoped CSS, CSS custom properties)
- Chinese (zh-CN) for all user-facing text
- Maintain existing design tokens from `style.css`

---

### Task 1: useChat.ts — Retry Support & Error State

**Files:**
- Modify: `client/src/composables/useChat.ts`

**Interfaces:**
- Produces: `retry(): Promise<void>` — re-submits last review request
- Produces: `lastError: Ref<string | null>` — latest error message for UI binding

- [ ] **Step 1: Add lastRequest and lastError state**

In `client/src/composables/useChat.ts`, add after line 12 (`const language = ref('typescript')`):

```typescript
const lastCode = ref('')
const lastLang = ref('typescript')
const lastError = ref<string | null>(null)
```

- [ ] **Step 2: Save request params in startReview before API call**

In `startReview`, after `store.loading = true` (line 16), add:

```typescript
lastCode.value = code
lastLang.value = lang
lastError.value = null
```

- [ ] **Step 3: Capture error in catch block**

In the `catch` block (line 34), add `lastError.value = message` before `store.addMessage`. Change the catch block to:

```typescript
} catch (error) {
  const message = error instanceof Error ? error.message : '创建任务失败'
  lastError.value = message
  store.addMessage({
    role: 'system',
    content: `错误：${message}`,
    type: 'agent_thought'
  })
  store.loading = false
}
```

- [ ] **Step 4: Add retry() method**

After `startReview` (before `return`), add:

```typescript
async function retry() {
  if (!lastCode.value.trim()) return
  await startReview(lastCode.value, lastLang.value)
}
```

- [ ] **Step 5: Expose new exports in return statement**

Change the return statement (line 45) to:

```typescript
return { codeInput, language, lastError, startReview, retry, disconnect }
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd client && npx vue-tsc --noEmit`
Expected: No errors related to useChat.ts

---

### Task 2: useSSE.ts — Auto Reconnect & Manual Retry

**Files:**
- Modify: `client/src/composables/useSSE.ts`

**Interfaces:**
- Produces: `retrySSE(taskId: string): void` — re-establishes SSE connection
- Consumes: `store` from `useReviewStore` (existing)

- [ ] **Step 1: Add reconnect tracking state**

In `useSSE()`, after `let eventSource: EventSource | null = null`, add:

```typescript
let reconnectAttempted = false
```

- [ ] **Step 2: Modify onerror to attempt reconnect once**

Replace the `onerror` handler (lines 107-111) with:

```typescript
eventSource.onerror = () => {
  if (!reconnectAttempted) {
    reconnectAttempted = true
    eventSource?.close()
    setTimeout(() => {
      connect(taskId)
    }, 2000)
    return
  }
  store.loading = false
  store.setStatus('failed')
  store.addMessage({
    role: 'system',
    content: '错误：SSE 连接丢失，请检查网络后重试',
    type: 'agent_thought'
  })
  eventSource?.close()
}
```

- [ ] **Step 3: Reset reconnect flag in connect()**

In `connect()`, at the start (after `const url = ...`), add:

```typescript
reconnectAttempted = false
```

- [ ] **Step 4: Add manual retrySSE() method**

After `disconnect()` (before `return`), add:

```typescript
function retrySSE(id: string) {
  disconnect()
  reconnectAttempted = false
  store.loading = true
  connect(id)
}
```

- [ ] **Step 5: Expose retrySSE in return**

Change the return statement to:

```typescript
return { connect, disconnect, retrySSE }
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd client && npx vue-tsc --noEmit`
Expected: No errors related to useSSE.ts

---

### Task 3: App.vue — Chinese Subtitle

**Files:**
- Modify: `client/src/App.vue`

**Interfaces:**
- None (purely visual change)

- [ ] **Step 1: Add Chinese subtitle span in template**

Replace line 24:

```html
<span class="logo-text">CodeAgentReview</span>
```

With:

```html
<span class="logo-text">CodeAgentReview<span class="logo-text-cn"> 多智能体代码审查平台</span></span>
```

- [ ] **Step 2: Add CSS for subtitle**

In `<style scoped>`, after `.logo-text` rule (lines 86-91), add:

```css
.logo-text-cn {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-muted);
  letter-spacing: 0;
}
```

- [ ] **Step 3: Verify visually**

Run: `cd client && npm run dev`
Expected: Navbar shows "CodeAgentReview 多智能体代码审查平台" with proper hierarchy

---

### Task 4: ChatMessage.vue — Error Display & Retry Button

**Files:**
- Modify: `client/src/components/ChatMessage.vue`

**Interfaces:**
- Consumes: `onRetry?: () => void` — callback prop from parent ChatView

- [ ] **Step 1: Add onRetry prop**

Replace the `defineProps` block (lines 4-6) with:

```typescript
const props = defineProps<{
  message: ChatMessageType
  onRetry?: () => void
}>()
```

- [ ] **Step 2: Add isError computed**

After `defineProps`, add:

```typescript
import { computed } from 'vue'

const isError = computed(() =>
  props.message.role === 'system' && props.message.content.startsWith('错误：')
)
```

Move the `computed` import to line 1 — merge it into the existing Vue import if needed. Actually, since the file currently has no `computed` import, add it to the template's `<script setup>` block. But wait — the file currently imports from Vue implicitly (no explicit import statement). Let me check...

Looking at the file, it doesn't import `computed` from Vue. I need to add it. But actually in `<script setup>`, Vue functions are auto-imported if using `unplugin-vue-components` or similar, but this project doesn't seem to have that. Let me just add `computed` to the existing import style.

Actually, looking at the file more carefully — it has no Vue imports at all, just `import type { ChatMessage }`. With Vue 3 `<script setup>`, you don't need to import `defineProps` or `computed` — they are compiler macros. Actually, `computed` is NOT a compiler macro, only `defineProps`, `defineEmits`, `defineExpose`, `withDefaults` are. So `computed` needs to be imported from 'vue'.

Let me update the plan...

- [ ] **Step 1 (revised): Add vue import and onRetry prop**

Add import at line 1:

```typescript
import { computed } from 'vue'
```

And update `defineProps`:

```typescript
const props = defineProps<{
  message: ChatMessageType
  onRetry?: () => void
}>()
```

- [ ] **Step 2: Add isError computed**

After the props block, add:

```typescript
const isError = computed(() =>
  props.message.role === 'system' && props.message.content.startsWith('错误：')
)
```

- [ ] **Step 3: Add retry button in template**

In the template, after the `.message-content` div (after line 42, before `</div>` on line 43), add:

```html
<div v-if="isError && onRetry" class="message-actions">
  <el-button size="small" type="danger" plain @click="onRetry">
    重试
  </el-button>
</div>
```

- [ ] **Step 4: Add error-specific CSS classes to chat-message div**

Change the root div (line 29) from:

```html
<div class="chat-message" :class="getRoleClass(message.role)">
```

To:

```html
<div class="chat-message" :class="[getRoleClass(message.role), { 'is-error': isError }]">
```

- [ ] **Step 5: Add CSS for error state and retry button**

In `<style scoped>`, after `.tool-name` rule (line 150), add:

```css
.chat-message.is-error {
  border-left: 3px solid var(--color-danger);
  background: #fef2f2;
}

.message-actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}
```

- [ ] **Step 6: Verify TypeScript**

Run: `cd client && npx vue-tsc --noEmit`

---

### Task 5: CodeInput.vue — Input Interaction Optimization

**Files:**
- Modify: `client/src/components/CodeInput.vue`

**Interfaces:**
- Consumes: `disabled` prop (existing)
- Produces: `submit` event (existing)

- [ ] **Step 1: Add new state variables**

After `const codeLineCount = ref(0)` (line 20), add:

```typescript
const urlError = ref('')
const textareaRows = ref(8)
```

- [ ] **Step 2: Add watch for adaptive textarea height**

Add `watch` import. Change line 2 from `import { ref } from 'vue'` to:

```typescript
import { ref, watch, nextTick } from 'vue'
```

After the `languages` array (after line 34), add:

```typescript
watch(code, () => {
  const lines = code.value.split('\n').length
  textareaRows.value = Math.min(20, Math.max(8, lines + 2))
  if (code.value.trim()) {
    codeLineCount.value = lines
  } else {
    codeLineCount.value = 0
  }
})
```

- [ ] **Step 3: Rewrite handleFetchUrl for inline error**

Replace the existing `handleFetchUrl` function with:

```typescript
async function handleFetchUrl() {
  const url = urlInput.value.trim()
  if (!url) return

  fetching.value = true
  urlError.value = ''
  try {
    const response = await axios.post(`${API_BASE}/tasks/fetch-url`, { url })
    const { content, lineCount } = response.data

    code.value = content
    codeLineCount.value = lineCount

    const cleanUrl = url.split('?')[0].split('#')[0]
    const extMatch = cleanUrl.match(/\.(\w+)$/)
    if (extMatch) {
      const ext = extMatch[1].toLowerCase()
      const extMap: Record<string, string> = {
        ts: 'typescript', tsx: 'typescript',
        js: 'javascript', jsx: 'javascript',
        py: 'python', java: 'java', go: 'go',
        rs: 'rust', rb: 'ruby', cpp: 'cpp',
        c: 'c', css: 'css', html: 'html'
      }
      if (extMap[ext]) {
        language.value = extMap[ext]
      }
    }

    if (lineCount > 500) {
      ElMessage.warning(`代码较长（${lineCount} 行），完整代码已加载，可滚动查看`)
    } else {
      ElMessage.success(`已抓取 ${lineCount} 行 ${language.value} 代码，可编辑后提交审查`)
    }
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data?.error) {
      urlError.value = error.response.data.error
    } else {
      urlError.value = '网络请求失败，请检查链接'
    }
  } finally {
    fetching.value = false
  }
}
```

- [ ] **Step 4: Add clearCode function**

After `handleFetchUrl`, add:

```typescript
function clearCode() {
  code.value = ''
  codeLineCount.value = 0
  textareaRows.value = 8
  urlError.value = ''
}
```

- [ ] **Step 5: Add keyboard handler**

After `clearCode`, add:

```typescript
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    handleSubmit()
  }
}
```

- [ ] **Step 6: Update template — input-header with clear button**

Replace the existing `.input-header` div (lines 97-107):

```html
<div class="input-header">
  <label class="input-label">语言</label>
  <el-select v-model="language" size="small" :disabled="disabled" class="lang-select">
    <el-option
      v-for="lang in languages"
      :key="lang.value"
      :label="lang.label"
      :value="lang.value"
    />
  </el-select>
  <span class="header-spacer"></span>
  <el-button
    v-if="code.trim()"
    size="small"
    type="default"
    text
    @click="clearCode"
  >
    清空
  </el-button>
</div>
```

- [ ] **Step 7: Update template — url-row with inline error**

After the url-row div, add inline error display. Replace the closing `</div>` of url-row (after `</el-button>` on line 129) by adding:

```html
<div v-if="urlError" class="url-error">{{ urlError }}</div>
```

Place this after the `</div>` of `.url-row`.

- [ ] **Step 8: Update template — code textarea with keydown and dynamic rows**

Replace the el-input textarea (lines 136-143):

```html
<el-input
  v-model="code"
  type="textarea"
  :rows="textareaRows"
  :disabled="disabled"
  placeholder="将代码粘贴到这里，或在上方输入 URL 后点击「抓取」"
  class="code-textarea"
  @keydown="onKeydown"
/>
```

- [ ] **Step 9: Update template — submit button with hint**

Replace the submit button (lines 145-153):

```html
<div class="submit-row">
  <el-button
    type="primary"
    :disabled="disabled || !code.trim()"
    :loading="disabled"
    @click="handleSubmit"
    class="submit-btn"
  >
    {{ disabled ? '审查中...' : '开始审查' }}
  </el-button>
  <span class="shortcut-hint">Ctrl+Enter 快速提交</span>
</div>
```

- [ ] **Step 10: Add new CSS rules**

In `<style scoped>`, add after the `.input-header` styles:

```css
.header-spacer {
  flex: 1;
}
```

After the `.url-row` styles, add:

```css
.url-error {
  font-size: 12px;
  color: var(--color-danger);
  margin-top: -8px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.url-error::before {
  content: '⚠';
  font-size: 12px;
}
```

After the `.submit-btn` styles, add:

```css
.submit-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.shortcut-hint {
  font-size: 12px;
  color: var(--color-text-muted);
}
```

- [ ] **Step 11: Verify TypeScript**

Run: `cd client && npx vue-tsc --noEmit`
Expected: No new errors

---

### Task 6: ChatView.vue — Empty State Guide & Retry Wiring

**Files:**
- Modify: `client/src/components/ChatView.vue`

**Interfaces:**
- Consumes: `useChat().retry`, `useChat().lastError` from Task 1
- Consumes: `useSSE().retrySSE` from Task 2
- Consumes: `ChatMessage.onRetry` prop from Task 4

- [ ] **Step 1: Update script to destructure retry and store taskId**

Replace the `<script setup>` block (lines 1-10):

```typescript
import { useReviewStore } from '../stores/review'
import { useChat } from '../composables/useChat'
import CodeInput from './CodeInput.vue'
import ChatMessage from './ChatMessage.vue'
import ReviewReport from './ReviewReport.vue'

const store = useReviewStore()
const { startReview, retry } = useChat()

function onRetry() {
  retry()
}
```

- [ ] **Step 2: Add empty state template**

Replace the empty message-list conditional area. The current template has:

```html
<div class="message-list" v-if="store.messages.length > 0 || store.loading">
```

Keep this, but add a `v-else` block before the closing `</div>` of `.chat-view`. Insert after the `.input-area` div (after line 29):

```html
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
      <div class="example-card" @click="startReview('function add(a: number, b: number): number {\n  return a - b\n}\n\nfunction divide(a: number, b: number): number {\n  if (b === 0) throw new Error(\"Division by zero\")\n  return a / b\n}', 'typescript')">
        <span class="example-lang">TypeScript</span>
        <span class="example-desc">审查函数逻辑与类型安全</span>
        <span class="example-arrow">→</span>
      </div>
      <div class="example-card" @click="startReview('def fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)\n\ndef read_file(path):\n    f = open(path, \"r\")\n    return f.read()', 'python')">
        <span class="example-lang">Python</span>
        <span class="example-desc">审查性能与资源管理</span>
        <span class="example-arrow">→</span>
      </div>
      <div class="example-card" @click="startReview('console.log(\"hello world\")', 'javascript')">
        <span class="example-lang">粘贴 URL</span>
        <span class="example-desc">从 GitHub / Gist 抓取代码</span>
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
```

- [ ] **Step 3: Pass onRetry to ChatMessage**

In the ChatMessage usage (line 16), change from:

```html
<ChatMessage :message="msg" />
```

To:

```html
<ChatMessage :message="msg" :onRetry="msg.role === 'system' && msg.content.startsWith('错误：') ? onRetry : undefined" />
```

- [ ] **Step 4: Add welcome guide CSS**

In `<style scoped>`, add after the existing styles:

```css
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
```

- [ ] **Step 5: Add responsive CSS for example cards**

Add after the step styles:

```css
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
```

- [ ] **Step 6: Verify build**

Run: `cd client && npx vue-tsc --noEmit && npm run build`
Expected: Build succeeds with no errors

---

## Execution Order

```
Task 1 (useChat)  ──┐
                    ├── Task 4 (ChatMessage) ── Task 6 (ChatView)
Task 2 (useSSE)   ──┘

Task 3 (App.vue)  ── (independent)

Task 5 (CodeInput) ── (independent)

Task 6 (ChatView) depends on 1, 2, 4
Tasks 3, 5 can run in parallel
```
