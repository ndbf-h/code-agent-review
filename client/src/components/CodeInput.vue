<script setup lang="ts">
import { ref, watch } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { detectLanguage } from '../utils/detectLanguage'

const props = defineProps<{
  disabled: boolean
}>()

const emit = defineEmits<{
  submit: [code: string, language: string]
}>()

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api'

const code = ref('')
const language = ref('typescript')
const urlInput = ref('')
const fetching = ref(false)
const codeLineCount = ref(0)
const urlError = ref('')
const textareaRows = ref(8)
const detectedLang = ref<string | null>(null)
/** 用户是否手动改过语言（手动选择后不再自动覆盖） */
const userPickedLang = ref(false)

const languages = [
  { label: 'TypeScript', value: 'typescript' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'Python', value: 'python' },
  { label: 'Java', value: 'java' },
  { label: 'Go', value: 'go' },
  { label: 'Rust', value: 'rust' },
  { label: 'Ruby', value: 'ruby' },
  { label: 'C++', value: 'cpp' },
  { label: 'C', value: 'c' },
  { label: 'CSS', value: 'css' },
  { label: 'HTML', value: 'html' }
]

watch(code, () => {
  const lines = code.value.split('\n').length
  textareaRows.value = Math.min(20, Math.max(8, lines + 2))
  if (code.value.trim()) {
    codeLineCount.value = lines
  } else {
    codeLineCount.value = 0
    detectedLang.value = null
    return
  }

  // 自动检测语言：仅在用户未手动选择时生效
  if (!userPickedLang.value && code.value.trim().length > 20) {
    const result = detectLanguage(code.value)
    if (result.confident && languages.some(l => l.value === result.language)) {
      language.value = result.language
      detectedLang.value = result.language
    }
  }
})

/** 用户手动切换语言：记录选择，后续不再自动覆盖 */
function onLangChange(value: string) {
  language.value = value
  userPickedLang.value = true
  detectedLang.value = null
}

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

function clearCode() {
  code.value = ''
  codeLineCount.value = 0
  textareaRows.value = 8
  urlError.value = ''
  userPickedLang.value = false
  detectedLang.value = null
}

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    handleSubmit()
  }
}

function handleSubmit() {
  if (!code.value.trim()) return
  emit('submit', code.value, language.value)
}
</script>

<template>
  <div class="code-input">
    <div class="input-header">
      <label class="input-label">语言</label>
      <el-select
        :model-value="language"
        @update:model-value="onLangChange"
        size="small"
        :disabled="disabled"
        class="lang-select"
      >
        <el-option
          v-for="lang in languages"
          :key="lang.value"
          :label="lang.label"
          :value="lang.value"
        />
      </el-select>
      <span v-if="detectedLang && detectedLang === language" class="auto-detect-badge">自动识别</span>
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

    <!-- URL 抓取栏 -->
    <div class="url-row">
      <el-input
        v-model="urlInput"
        size="small"
        placeholder="或粘贴分享链接（GitHub / Gist / Pastebin...）"
        :disabled="disabled"
        clearable
        @keyup.enter="handleFetchUrl"
        class="url-input"
      />
      <el-button
        size="small"
        type="default"
        :disabled="disabled || !urlInput.trim()"
        :loading="fetching"
        @click="handleFetchUrl"
      >
        抓取
      </el-button>
    </div>

    <div v-if="urlError" class="url-error">{{ urlError }}</div>

    <!-- 代码行数提示 -->
    <div v-if="codeLineCount > 0 && !disabled" class="line-hint">
      {{ codeLineCount }} 行 · {{ code.length.toLocaleString() }} 字符
    </div>

    <el-input
      v-model="code"
      type="textarea"
      :rows="textareaRows"
      :disabled="disabled"
      placeholder="将代码粘贴到这里，或在上方输入 URL 后点击「抓取」"
      class="code-textarea"
      @keydown="onKeydown"
    />

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
  </div>
</template>

<style scoped>
.code-input {
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 24px;
  box-shadow: var(--shadow-sm);
}

.input-header {
  display: flex;
  align-items: center;
  gap: 14px;
}

.input-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  letter-spacing: -0.1px;
}

.lang-select {
  width: 170px;
}

.auto-detect-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-success-text);
  background: var(--color-success-bg);
  border-radius: 10px;
  white-space: nowrap;
  animation: badge-pop 0.25s ease;
}

.auto-detect-badge::before {
  content: '✨';
  font-size: 10px;
}

@keyframes badge-pop {
  0% { opacity: 0; transform: scale(0.8); }
  100% { opacity: 1; transform: scale(1); }
}

.header-spacer {
  flex: 1;
}

.url-row {
  display: flex;
  gap: 10px;
}

.url-input {
  flex: 1;
}

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

.line-hint {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-top: -8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.line-hint::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-success);
}

.code-textarea :deep(textarea) {
  font-family: var(--font-mono);
  font-size: 13.5px;
  line-height: 1.7;
  max-height: 420px;
  border-radius: var(--radius-sm);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.code-textarea :deep(textarea):focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(59, 92, 246, 0.1);
}

.submit-btn {
  align-self: flex-start;
  font-weight: 600;
  letter-spacing: -0.1px;
  border-radius: 20px;
  padding: 8px 24px;
  height: auto;
}

.submit-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.shortcut-hint {
  font-size: 12px;
  color: var(--color-text-muted);
}
</style>
