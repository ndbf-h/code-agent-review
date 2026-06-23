<script setup lang="ts">
import { ref } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'

const props = defineProps<{
  disabled: boolean
}>()

const emit = defineEmits<{
  submit: [code: string, language: string]
}>()

const API_BASE = 'http://localhost:3001/api'

const code = ref('')
const language = ref('typescript')
const urlInput = ref('')
const fetching = ref(false)
const codeLineCount = ref(0)

const languages = [
  { label: 'TypeScript', value: 'typescript' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'Python', value: 'python' },
  { label: 'Java', value: 'java' },
  { label: 'Go', value: 'go' }
]

async function handleFetchUrl() {
  const url = urlInput.value.trim()
  if (!url) return

  fetching.value = true
  try {
    const response = await axios.post(`${API_BASE}/tasks/fetch-url`, { url })
    const { content, lineCount } = response.data

    code.value = content
    codeLineCount.value = lineCount

    // 尝试从 URL 后缀推断语言
    const extMatch = url.match(/\.(\w+)$/)
    if (extMatch) {
      const ext = extMatch[1].toLowerCase()
      const extMap: Record<string, string> = {
        ts: 'typescript',
        tsx: 'typescript',
        js: 'javascript',
        jsx: 'javascript',
        py: 'python',
        java: 'java',
        go: 'go',
        rs: 'rust',
        rb: 'ruby',
        cpp: 'cpp',
        c: 'c',
        css: 'css',
        html: 'html'
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
    let message = '网络请求失败，请检查链接'
    if (axios.isAxiosError(error) && error.response?.data?.error) {
      message = error.response.data.error
    }
    ElMessage.error(message)
  } finally {
    fetching.value = false
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
      <el-select v-model="language" size="small" :disabled="disabled" class="lang-select">
        <el-option
          v-for="lang in languages"
          :key="lang.value"
          :label="lang.label"
          :value="lang.value"
        />
      </el-select>
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

    <!-- 代码行数提示 -->
    <div v-if="codeLineCount > 0 && !disabled" class="line-hint">
      {{ codeLineCount }} 行 · {{ code.length.toLocaleString() }} 字符
    </div>

    <el-input
      v-model="code"
      type="textarea"
      :rows="8"
      :disabled="disabled"
      placeholder="将代码粘贴到这里，或在上方输入 URL 后点击「抓取」"
      class="code-textarea"
    />

    <el-button
      type="primary"
      :disabled="disabled || !code.trim()"
      :loading="disabled"
      @click="handleSubmit"
      class="submit-btn"
    >
      开始审查
    </el-button>
  </div>
</template>

<style scoped>
.code-input {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.input-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.input-label {
  font-size: 13px;
  font-weight: 500;
  color: #606266;
}

.lang-select {
  width: 160px;
}

.url-row {
  display: flex;
  gap: 8px;
}

.url-input {
  flex: 1;
}

.line-hint {
  font-size: 12px;
  color: #909399;
  margin-top: -8px;
}

.code-textarea :deep(textarea) {
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.6;
  max-height: 400px;
}

.submit-btn {
  align-self: flex-start;
}
</style>
