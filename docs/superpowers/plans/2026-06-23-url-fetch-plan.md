# URL 代码抓取功能 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 URL 代码抓取功能，用户输入任意代码分享链接后自动抓取内容填入代码框。

**Architecture:** 后端新增 `POST /api/fetch-url` 路由，用原生 `fetch` 抓取 URL 内容；前端 `CodeInput.vue` 新增 URL 输入栏，抓取成功后填入代码框供预览编辑。

**Tech Stack:** Express 4 (路由) + Vue 3 + Element Plus + Axios

## Global Constraints

- 语言：TypeScript strict 模式
- 缩进：2 空格，不用 tab
- 字符串：单引号，不加分号
- 组件：`<script setup lang="ts">` + template + scoped style
- 错误处理：try-catch + async/await
- 超时限制：10 秒
- 内容上限：1 MB
- 仅 http/https 协议

---

### Task 1: 后端 — 新增 URL 抓取路由

**Files:**
- Modify: `server/src/routes/tasks.ts` — 在末尾 `export` 之前新增路由

**Interfaces:**
- Consumes: Express `Router`, `Request`, `Response`
- Produces: `POST /api/fetch-url` — 接收 `{ url: string }`，返回 `{ content, byteSize, lineCount }` 或 `{ error }`

---

- [ ] **Step 1: 在 tasks.ts 中新增 fetch-url 路由**

在 `server/src/routes/tasks.ts` 文件末尾的 `export { tasksRouter }` 之前，插入以下代码：

```typescript
// POST /api/fetch-url — 抓取 URL 代码内容
tasksRouter.post('/fetch-url', async (req: Request, res: Response) => {
  try {
    const { url } = req.body

    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: '请提供有效的 URL' })
      return
    }

    // 协议校验
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      res.status(400).json({ error: 'URL 格式不正确' })
      return
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      res.status(400).json({ error: '仅支持 http/https 链接' })
      return
    }

    // 抓取内容，10 秒超时
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    let response: Response
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'text/plain,text/html;q=0.5'
        },
        redirect: 'follow'
      })
    } catch (err) {
      clearTimeout(timeout)
      if (err instanceof Error && err.name === 'AbortError') {
        res.status(408).json({ error: '请求超时，请检查链接是否可访问' })
        return
      }
      res.status(502).json({ error: '网络请求失败，请检查链接是否有效' })
      return
    }
    clearTimeout(timeout)

    if (!response.ok) {
      res.status(502).json({ error: `目标服务器拒绝访问（${response.status}）` })
      return
    }

    // 检查 Content-Type，过滤明显非文本的响应
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/octet-stream')
      || contentType.includes('video/')
      || contentType.includes('audio/')
      || contentType.includes('image/')) {
      res.status(400).json({ error: '该链接不是文本文件，无法读取代码' })
      return
    }

    // 读取内容，限制 1MB
    const text = await response.text()
    if (text.length > 1_048_576) {
      res.status(400).json({ error: '文件过大（超过 1MB），请手动粘贴代码' })
      return
    }

    const lineCount = text.split('\n').length

    res.json({
      content: text,
      byteSize: text.length,
      lineCount
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    res.status(500).json({ error: `抓取失败：${message}` })
  }
})
```

**注意：** 需要将文件中已有的 `import type { Request, Response } from 'express'` 改为 `{ Router, type Request, type Response }` 如果还没导入 `Router`。当前文件顶部已经正确导入了，无需改动。

- [ ] **Step 2: 验证后端路由**

启动后端：

```bash
cd server && npm run dev
```

用 curl 测试：

```bash
curl -X POST http://localhost:3001/api/tasks/fetch-url \
  -H "Content-Type: application/json" \
  -d '{"url":"https://raw.githubusercontent.com/user/repo/main/README.md"}'
```

预期：返回 `{ content, byteSize, lineCount }` 或合理的错误信息。

- [ ] **Step 3: 提交**

```bash
git add server/src/routes/tasks.ts
git commit -m "feat: add POST /api/tasks/fetch-url route for code fetching"
```

---

### Task 2: 前端 — CodeInput.vue 新增 URL 输入栏

**Files:**
- Modify: `client/src/components/CodeInput.vue`

**Interfaces:**
- Consumes: `POST /api/fetch-url`（Task 1）
- Produces: 同上 emit 接口不变（`submit: [code, language]`），新增内部 URL 抓取逻辑

---

- [ ] **Step 1: 替换 CodeInput.vue 完整内容**

用以下代码覆盖 `client/src/components/CodeInput.vue`：

```vue
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
```

- [ ] **Step 2: 验证前端效果**

启动前端：

```bash
cd client && npm run dev
```

测试步骤：
1. 打开 http://localhost:5173
2. 在 URL 输入框粘贴一个有效的代码链接（如 GitHub Raw 链接），点击「抓取」
3. 确认代码正确填入输入框，行数提示正确显示
4. 粘贴一个无效链接，确认错误提示正常弹出
5. 代码填入后可手动编辑，点击「开始审查」正常发起

- [ ] **Step 3: 提交**

```bash
git add client/src/components/CodeInput.vue
git commit -m "feat: add URL fetch input bar to CodeInput component"
```

---

## 验证清单

- [ ] 输入有效 URL，代码正确填入，行数提示显示
- [ ] 输入无效 URL，ElMessage.error 弹出错误信息
- [ ] URL 结尾为已知扩展名时，自动切换语言选择器
- [ ] >500 行代码显示黄色警告而非绿色成功提示
- [ ] textarea max-height: 400px 生效，长代码不撑爆页面
- [ ] 抓取后仍可手动编辑代码再提交审查
- [ ] 抓取过程中按钮显示 loading 状态
- [ ] 后端拒绝非 http/https 协议
