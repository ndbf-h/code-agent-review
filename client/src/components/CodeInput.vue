<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  disabled: boolean
}>()

const emit = defineEmits<{
  submit: [code: string, language: string]
}>()

const code = ref('')
const language = ref('typescript')

const languages = [
  { label: 'TypeScript', value: 'typescript' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'Python', value: 'python' },
  { label: 'Java', value: 'java' },
  { label: 'Go', value: 'go' }
]

function handleSubmit() {
  if (!code.value.trim()) return
  emit('submit', code.value, language.value)
}
</script>

<template>
  <div class="code-input">
    <div class="input-header">
      <label class="input-label">Language</label>
      <el-select v-model="language" size="small" :disabled="disabled" class="lang-select">
        <el-option
          v-for="lang in languages"
          :key="lang.value"
          :label="lang.label"
          :value="lang.value"
        />
      </el-select>
    </div>

    <el-input
      v-model="code"
      type="textarea"
      :rows="8"
      :disabled="disabled"
      placeholder="Paste your code here..."
      class="code-textarea"
    />

    <el-button
      type="primary"
      :disabled="disabled || !code.trim()"
      :loading="disabled"
      @click="handleSubmit"
      class="submit-btn"
    >
      Start Review
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

.code-textarea :deep(textarea) {
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.6;
}

.submit-btn {
  align-self: flex-start;
}
</style>
