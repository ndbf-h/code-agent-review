<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import hljs from 'highlight.js'
import { ElMessage } from 'element-plus'

interface Change {
  line: number
  description: string
  before: string
  after: string
}

const props = defineProps<{
  originalCode: string
  fixedCode: string
  changes: Change[]
  language: string
}>()

const isEmpty = computed(() => props.changes.length === 0)

const changedOriginalLines = computed(() => {
  const set = new Set<number>()
  props.changes.forEach(c => set.add(c.line))
  return set
})

const changedFixedLines = computed(() => {
  const set = new Set<number>()
  props.changes.forEach(c => set.add(c.line))
  return set
})

const originalLines = computed(() => props.originalCode.split('\n'))
const fixedLines = computed(() => props.fixedCode.split('\n'))
const maxLines = computed(() => Math.max(originalLines.value.length, fixedLines.value.length))

const highlightedOriginal = ref<string[]>([])
const highlightedFixed = ref<string[]>([])

/**
 * 对代码进行语法高亮，返回按行分割的 HTML 数组
 */
function getHighlightedLines(code: string): string[] {
  if (!code) return []
  try {
    const result = hljs.highlight(code, { language: props.language })
    return result.value.split('\n')
  } catch {
    return code.split('\n').map(line => escapeHtml(line))
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function updateHighlighting() {
  highlightedOriginal.value = getHighlightedLines(props.originalCode)
  highlightedFixed.value = getHighlightedLines(props.fixedCode)
}

onMounted(() => {
  updateHighlighting()
})

watch(
  () => [props.originalCode, props.fixedCode, props.language],
  () => {
    updateHighlighting()
  }
)

function isOriginalChanged(lineNum: number): boolean {
  return changedOriginalLines.value.has(lineNum)
}

function isFixedChanged(lineNum: number): boolean {
  return changedFixedLines.value.has(lineNum)
}

async function copyFixedCode() {
  try {
    await navigator.clipboard.writeText(props.fixedCode)
    ElMessage.success('修复代码已复制到剪贴板')
  } catch {
    ElMessage.error('复制失败，请手动复制')
  }
}

function downloadFixedCode() {
  const blob = new Blob([props.fixedCode], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `fixed-code.${getFileExtension(props.language)}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function getFileExtension(lang: string): string {
  const map: Record<string, string> = {
    javascript: 'js',
    typescript: 'ts',
    python: 'py',
    java: 'java',
    go: 'go',
    rust: 'rs',
    html: 'html',
    css: 'css',
    sql: 'sql',
    json: 'json',
    xml: 'xml',
    yaml: 'yml',
    markdown: 'md',
    bash: 'sh',
    shell: 'sh',
    c: 'c',
    cpp: 'cpp',
    csharp: 'cs',
    ruby: 'rb',
    php: 'php',
    swift: 'swift',
    kotlin: 'kt',
    scala: 'scala',
    r: 'r',
    vue: 'vue',
    jsx: 'jsx',
    tsx: 'tsx'
  }
  return map[lang] || 'txt'
}

function severityTagType(change: Change): string {
  if (change.description.includes('高危') || change.description.includes('严重')) return 'danger'
  if (change.description.includes('建议') || change.description.includes('优化')) return 'primary'
  return 'warning'
}
</script>

<template>
  <div class="code-diff">
    <!-- 空状态 -->
    <div v-if="isEmpty" class="empty-state">
      <span class="empty-icon">&#10003;</span>
      <span class="empty-text">无需修改</span>
    </div>

    <template v-else>
      <!-- 工具栏 -->
      <div class="diff-toolbar">
        <el-tag size="small" type="info">{{ language }}</el-tag>
        <span class="toolbar-title">代码对比</span>
        <div class="toolbar-actions">
          <el-button size="small" text @click="copyFixedCode">
            复制修复代码
          </el-button>
          <el-button size="small" text @click="downloadFixedCode">
            下载修复文件
          </el-button>
        </div>
      </div>

      <!-- 双栏对比 -->
      <div class="diff-panels">
        <!-- 原始代码 -->
        <div class="diff-pane diff-pane-original">
          <div class="pane-header">
            <el-tag size="small" type="danger" effect="dark">原始代码</el-tag>
            <span class="pane-line-count">{{ originalLines.length }} 行</span>
          </div>
          <div class="code-table">
            <div
              v-for="(_, idx) in maxLines"
              :key="'orig-' + idx"
              class="code-row"
              :class="{ 'row-changed': isOriginalChanged(idx + 1) }"
            >
              <span
                class="line-num"
                :class="{ 'num-changed': isOriginalChanged(idx + 1) }"
              >
                {{ idx + 1 }}
              </span>
              <span
                class="line-content"
                v-html="highlightedOriginal[idx] || '&nbsp;'"
              ></span>
            </div>
          </div>
        </div>

        <!-- 修复代码 -->
        <div class="diff-pane diff-pane-fixed">
          <div class="pane-header">
            <el-tag size="small" type="success" effect="dark">修复代码</el-tag>
            <span class="pane-line-count">{{ fixedLines.length }} 行</span>
          </div>
          <div class="code-table">
            <div
              v-for="(_, idx) in maxLines"
              :key="'fixed-' + idx"
              class="code-row"
              :class="{ 'row-changed': isFixedChanged(idx + 1) }"
            >
              <span
                class="line-num"
                :class="{ 'num-fixed': isFixedChanged(idx + 1) }"
              >
                {{ idx + 1 }}
              </span>
              <span
                class="line-content"
                v-html="highlightedFixed[idx] || '&nbsp;'"
              ></span>
            </div>
          </div>
        </div>
      </div>

      <!-- 修改清单 -->
      <div class="changes-section">
        <div class="section-title">修改清单（{{ changes.length }} 处）</div>
        <el-collapse>
          <el-collapse-item
            v-for="(change, idx) in changes"
            :key="idx"
            :name="idx"
          >
            <template #title>
              <div class="change-title">
                <el-tag
                  size="small"
                  :type="severityTagType(change)"
                  effect="plain"
                >
                  L{{ change.line }}
                </el-tag>
                <span class="change-desc">{{ change.description }}</span>
              </div>
            </template>
            <div class="change-detail">
              <div class="change-block change-before">
                <span class="change-label">修改前：</span>
                <code>{{ change.before }}</code>
              </div>
              <div class="change-block change-after">
                <span class="change-label">修改后：</span>
                <code>{{ change.after }}</code>
              </div>
            </div>
          </el-collapse-item>
        </el-collapse>
      </div>
    </template>
  </div>
</template>

<style scoped>
.code-diff {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── 空状态 ── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 24px;
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
}

.empty-icon {
  font-size: 36px;
  color: var(--color-success);
}

.empty-text {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-success);
}

/* ── 工具栏 ── */
.diff-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
}

.toolbar-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  flex: 1;
}

.toolbar-actions {
  display: flex;
  gap: 4px;
}

/* ── 双栏对比 ── */
.diff-panels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.diff-pane {
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.diff-pane-original {
  border-top: 3px solid var(--color-danger);
}

.diff-pane-fixed {
  border-top: 3px solid var(--color-success);
}

.pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--color-surface-2);
  border-bottom: 1px solid var(--color-border-light);
}

.pane-line-count {
  font-size: 12px;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}

/* ── 代码表格 ── */
.code-table {
  overflow-x: auto;
  flex: 1;
}

.code-row {
  display: flex;
  min-height: 22px;
  line-height: 22px;
  font-family: var(--font-mono);
  font-size: 13px;
  border-bottom: 1px solid transparent;
}

.code-row.row-changed {
  background: var(--color-diff-remove-bg);
}

.diff-pane-fixed .code-row.row-changed {
  background: var(--color-diff-add-bg);
}

.line-num {
  display: inline-block;
  width: 48px;
  min-width: 48px;
  text-align: right;
  padding-right: 12px;
  color: var(--color-text-muted);
  font-size: 12px;
  user-select: none;
  border-right: 1px solid var(--color-border-light);
  background: var(--color-surface-2);
}

.line-num.num-changed {
  background: var(--color-diff-remove-bg);
  color: var(--color-danger-text);
  font-weight: 600;
}

.line-num.num-fixed {
  background: var(--color-diff-add-bg);
  color: var(--color-success-text);
  font-weight: 600;
}

.line-content {
  padding-left: 12px;
  white-space: pre;
  flex: 1;
  overflow-x: auto;
}

.line-content :deep(.hljs) {
  background: transparent;
  padding: 0;
}

/* ── 修改清单 ── */
.changes-section {
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  padding: 16px 20px;
}

.section-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
}

.change-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
}

.change-desc {
  font-size: 13px;
  color: var(--color-text);
  font-weight: 500;
}

.change-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0 8px;
}

.change-block {
  font-size: 13px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  line-height: 1.6;
}

.change-before {
  background: var(--color-diff-remove-bg);
  color: var(--color-danger-text);
}

.change-after {
  background: var(--color-diff-add-bg);
  color: var(--color-success-text);
}

.change-label {
  font-weight: 600;
}

.change-block code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--color-code-bg);
  padding: 1px 6px;
  border-radius: 4px;
}

/* ── 响应式：移动端上下堆叠 ── */
@media (max-width: 768px) {
  .diff-panels {
    grid-template-columns: 1fr;
  }

  .toolbar-title {
    display: none;
  }

  .toolbar-actions {
    margin-left: auto;
  }
}
</style>
