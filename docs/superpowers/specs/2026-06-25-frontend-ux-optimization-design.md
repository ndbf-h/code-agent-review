# Frontend UX Optimization Design

**Date**: 2026-06-25
**Status**: Approved
**Approach**: Progressive Enhancement (方案 A)

---

## 1. 导航栏：追加中文名称

**文件**: `client/src/App.vue`

在 logo 文字 `CodeAgentReview` 后追加中文副标题 `多智能体代码审查平台`。

**实现**:
- 新增 `<span class="logo-text-cn">多智能体代码审查平台</span>`
- 中文部分使用稍小字号（13px）、较轻字重（500）、次要文字颜色，与主标题形成层级对比

---

## 2. 空状态引导页

**文件**: `client/src/components/ChatView.vue`

当 `store.messages.length === 0 && !store.loading` 时，展示引导卡片替代空白区域。

**内容**:
- 欢迎标题 + 一句话说明（多智能体四维度审查）
- 三张「快速开始」示例卡片：TypeScript 代码审查、Python 代码审查、URL 抓取审查
  - 点击后自动填入对应代码/URL 并选中语言
- 使用步骤：① 选择语言 → ② 粘贴代码/输入URL → ③ 开始审查 → ④ 查看各代理分析 → ⑤ 获取综合报告

**样式**: 浅色背景、圆角、微妙阴影，保持与整体设计语言一致。

---

## 3. 错误恢复与重试

### 3.1 任务创建失败重试

**文件**: `client/src/composables/useChat.ts`

- 保存最后一次请求参数（code, language）
- 暴露 `retry()` 方法，使用保存的参数重新发起请求
- 暴露 `lastError` 状态供 UI 判断

### 3.2 SSE 断连自动重连

**文件**: `client/src/composables/useSSE.ts`

- 首次 `onerror` 自动重连一次（间隔 2 秒）
- 重连失败后通过 store 添加错误消息
- 暴露 `retry(taskId)` 方法支持手动重连

### 3.3 错误消息卡片 + 重试按钮

**文件**: `client/src/components/ChatMessage.vue`

- 新增 `onRetry` prop，当消息为错误类型时显示「重试」按钮
- 错误消息视觉区分：红色左侧竖线，浅红背景

**文件**: `client/src/components/ChatView.vue`

- 传递重试回调给 ChatMessage

### 3.4 URL 抓取内联错误

**文件**: `client/src/components/CodeInput.vue`

- 新增 `urlError` 状态，抓取失败时在 URL 输入栏下方显示红色错误提示
- 保留用户输入的 URL，允许修改后重试
- 替代当前 `ElMessage.error` 弹窗方式

---

## 4. 输入交互优化

**文件**: `client/src/components/CodeInput.vue`

### 4.1 清空按钮
- 代码输入框右上角「清空」文字按钮
- 仅在有内容时显示
- 点击清空代码 + 重置行数统计

### 4.2 快捷键提交
- 监听 `@keydown`，`Ctrl+Enter` 触发 `handleSubmit()`

### 4.3 粘贴自动统计
- 监听 `@paste`，更新 `codeLineCount` 和字符数
- 不再仅依赖 URL 抓取后才显示行数统计

### 4.4 自适应高度
- 根据内容行数动态调整 `rows`（最少 8，最多 20）
- 通过 `watch` 监听 `code` 变化自动计算

### 4.5 提交按钮状态
- 审查中时按钮文字改为「审查中...」
- 禁用状态时显示简洁提示文字

---

## Summary of Changes

| File | Changes |
|------|---------|
| `App.vue` | 添加中文副标题 |
| `ChatView.vue` | 空状态引导模板、重试回调传递 |
| `ChatMessage.vue` | 错误消息样式 + 重试按钮 |
| `CodeInput.vue` | 清空按钮、快捷键、粘贴统计、自适应高度、内联错误提示、按钮状态 |
| `useChat.ts` | 保存请求参数、暴露 retry()、lastError |
| `useSSE.ts` | 自动重连、暴露 retry() |

**不新增组件** — 所有改动在现有文件内完成，降低风险。
