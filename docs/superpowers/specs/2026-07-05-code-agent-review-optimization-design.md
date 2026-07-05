# CodeAgentReview 全栈优化设计文档

> 日期：2026-07-05
> 状态：设计完成，待实施
> 策略：方案 B —— 分层递进，体验优先

---

## 项目背景

**CodeAgentReview** 是一个多 Agent 代码审查平台，技术栈为 Vue 3 + Element Plus + Express 4 + sql.js + 手写 ReAct Agent 引擎。目前处于早期 demo 阶段，存在以下核心问题：

- 7 个工具全部返回硬编码 Mock 数据，审查结果不可信
- LLM 调用无流式输出，用户需长时间盲等
- 无重试/退避机制，一次失败即任务中断
- JSON 解析依赖脆弱正则，审查数据经常丢失
- 无测试覆盖、无严格类型检查、无错误体系

## 优化策略：分层递进

```
① 基础设施 → ② LLM 客户端 → ③ 工具真实化 → ④ Agent 引擎 → ⑤ 前端体验 → ⑥ 架构加固
```

每层自包含、可独立验证，上层依赖下层能力。

---

## 第 ① 层：基础设施

### TypeScript 严格模式

- `server/tsconfig.json` 和 `client/tsconfig.json` 开启 `"strict": true`
- 修复所有隐式类型、`any` 类型问题

### 统一错误体系

- 新增 `server/src/errors.ts`：定义 `AppError` 基类
- 派生 `LlmError`、`ToolError`、`TaskError`、`ValidationError`
- 所有 API 路由统一错误格式：`{ error: string, code: string, details?: unknown }`

### 日志系统

- 新增 `server/src/logger.ts`：分级日志（DEBUG/INFO/WARN/ERROR）
- 带时间戳和模块名，Agent 执行过程全量记录

### 测试框架

- 引入 Vitest，覆盖核心模块：`llm-client`、`tool-registry`、`react-loop`、`orchestrator`
- 测试目录：`server/src/**/__tests__/`、`client/src/**/__tests__/`
- 目标：关键路径有测试即可，不要求覆盖率

### 改动文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `server/tsconfig.json` | 修改 | 开启 strict |
| `client/tsconfig.json` | 修改 | 开启 strict |
| `server/src/errors.ts` | 新增 | 统一错误类型 |
| `server/src/logger.ts` | 新增 | 分级日志 |
| `server/package.json` | 修改 | 添加 vitest 依赖 |
| `client/package.json` | 修改 | 添加 vitest 依赖 |

---

## 第 ② 层：LLM 客户端增强

### 流式输出

- `llm-client.ts` 新增 `chatStream()` 方法
- 返回 `AsyncGenerator<StreamChunk>`，chunk 类型：
  ```typescript
  type StreamChunk =
    | { type: 'text'; content: string }
    | { type: 'tool_use'; name: string; input: Record<string, unknown> }
    | { type: 'done'; finishReason: string }
  ```
- OpenAI/Anthropic 两套协议的 streaming 格式均支持

### 重试 + 指数退避

- 新增 `chatWithRetry()` 封装
- 重试次数：3（可通过 `LLM_MAX_RETRIES` 配置）
- 退避间隔：1s → 2s → 4s
- 仅对网络错误和 5xx 重试，4xx 立即抛错

### 结构化 JSON 输出

- 新增 `chatStructured<T>()` 方法
- 利用 LLM JSON mode（OpenAI `response_format: { type: "json_object" }`）
- 返回自动解析 + Zod schema 校验的结果
- 解析失败自动重试一次（附带格式修正提示）

### Provider 配置标准化

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `LLM_PROVIDER` | `openai` | openai / anthropic / deepseek / moonshot / zhipu |
| `LLM_BASE_URL` | 按 provider 自动选择 | API 地址 |
| `LLM_MODEL` | `deepseek-chat` | 模型名称 |
| `LLM_API_KEY` | （必填） | API Key |
| `LLM_MAX_RETRIES` | `3` | 最大重试次数 |

### 改动文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `server/src/agent/llm-client.ts` | 重写 | stream/retry/structured 能力 |
| `server/src/agent/llm-types.ts` | 新增 | 拆分类型定义，避免循环引用 |
| `server/src/agent/__tests__/llm-client.test.ts` | 新增 | 单元测试 |

---

## 第 ③ 层：工具层真实化

### 设计原则

- **LLM 负责语义理解**，工具负责规则验证
- 工具输出结构化事实，不替代 LLM 判断
- 所有工具输出统一 JSON Schema

### 审查类工具（真实分析，替代 Mock）

| 工具 | 输入 | 作用 | 实现方式 |
|---|---|---|---|
| `readFile` | 无 | 返回用户提交的完整代码 | 直接返回内存中的代码 |
| `analyzePatterns` | `pattern: string` | 对代码运行真实正则规则匹配 | 调用规则库中的正则逐行扫描 |
| `checkComplexity` | 无 | 计算圈复杂度、嵌套深度、行数 | 纯算法计算 |
| `validateSyntax` | `language: string` | 语法检查 | JS/TS 用 acorn；其他语言用正则兜底 |

### 编排类工具（去 Mock）

| 工具 | 改动说明 |
|---|---|
| `decomposeTask` | 去掉硬编码返回，让 LLM 实际分析代码后输出拆分维度 |
| `assignAgent` | 改为触发审查 Agent 的实际注册 |
| `collectResults` | 改为从运行时审查结果中聚合 |
| `generateReport` | 去掉硬编码，让 LLM 基于真实审查结果生成报告 |

### 规则库

新增 `server/src/tools/rules/` 目录：

| 文件 | 覆盖规则 |
|---|---|
| `security.ts` | SQL 注入、XSS、硬编码密钥、路径遍历、eval/innerHTML |
| `performance.ts` | 循环内查询、同步阻塞、N+1 查询、大数组操作 |
| `style.ts` | 命名规范、注释缺失、函数过长（>50行）、嵌套过深 |
| `logic.ts` | 空值检查、类型安全、边界条件、异常处理缺失 |

每条规则结构：
```typescript
interface Rule {
  name: string
  pattern: RegExp
  severity: 'critical' | 'warning' | 'suggestion'
  category: string
  message: (match: RegExpMatchArray) => string
  suggestion: string
}
```

### 工具注册增强

- 工具执行统一加 5 秒超时
- 同一代码 + 参数的结果缓存（避免重复计算）
- 工具错误统一走 `ToolError`

### 改动文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `server/src/tools/review.ts` | 重写 | 接入规则库，真实分析 |
| `server/src/tools/orchestration.ts` | 重写 | 去 Mock |
| `server/src/tools/rules/index.ts` | 新增 | 规则库入口 |
| `server/src/tools/rules/security.ts` | 新增 | 安全规则 |
| `server/src/tools/rules/performance.ts` | 新增 | 性能规则 |
| `server/src/tools/rules/style.ts` | 新增 | 风格规则 |
| `server/src/tools/rules/logic.ts` | 新增 | 逻辑规则 |
| `server/src/agent/tool-registry.ts` | 增强 | 超时+缓存+错误处理 |
| `server/src/tools/__tests__/tools.test.ts` | 新增 | 工具测试 |

---

## 第 ④ 层：Agent 引擎增强

### ReAct 循环优化

| 优化点 | 改之前 | 改之后 |
|---|---|---|
| 流式思考 | 等完整回复才推送 | 逐 token 推送前端 |
| 动态轮数 | 固定 5 轮 | Agent 自行判断是否结束，上限 10 轮 |
| 工具失败恢复 | 工具报错直接结束 | 错误反馈给 LLM，换方式重试 |
| 思考-行动分离 | 混在一起 | 明确 thought → action → observation 三步 |

### Memory 持久化

- 保持内存 Memory 作为热路径（速度优先）
- 每轮结束后异步写入 SQLite `messages` 表
- 前端可回看完整 Agent 思考过程

### 审查结果结构化

- 使用第 ② 层的 `chatStructured<T>()` 替代脆弱的正则 JSON 提取
- Zod schema 校验审查结果格式
- 解析失败自动重试一次

### 审查并行优化

- Orchestrator 先做代码分解（识别函数、模块、关注点）
- 每个 reviewer 带着"维度指令 + 代码结构信息"开始审查
- 减少 4 个 reviewer 的重复推理

### 改动文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `server/src/agent/react-loop.ts` | 重写 | 流式+动态轮数+错误恢复 |
| `server/src/agent/orchestrator.ts` | 重写 | chatStructured + 预分解 |
| `server/src/agent/memory.ts` | 增强 | 异步持久化到 SQLite |
| `server/src/agent/types.ts` | 扩展 | 新增 Agent 相关类型 |
| `server/src/agent/__tests__/react-loop.test.ts` | 新增 | ReAct 循环测试 |
| `server/src/agent/__tests__/orchestrator.test.ts` | 新增 | 编排器测试 |

---

## 第 ⑤ 层：前端体验层

### 流式输出展示

- 新增 `useTypewriter` composable：打字机效果
- 4 个 Agent 卡片并排展示，实时显示每个 Agent 的流式思考内容
- Agent 卡片状态独立管理：working / done / error

### Markdown 渲染 + 代码高亮

- 引入 `markdown-it`：Agent 思考内容支持 Markdown
- 引入 `highlight.js`：审查报告中的代码片段语法高亮

### 过渡动画

| 场景 | 效果 |
|---|---|
| Agent 卡片状态切换 | idle→working 缩放脉冲，working→done 绿色勾淡入 |
| 消息列表 | 新消息滑入（Vue `<TransitionGroup>`） |
| 审查报告 | 分数数字翻滚动画，问题列表逐条展开 |
| 错误状态 | 红色边框闪烁 + 抖动 |

### 状态全覆盖

```
idle → orchestrating → reviewing（4 Agent 独立状态）→ summarizing → completed
                                                         → failed（附重试按钮）
```

- 每个中间状态有对应 UI（骨架屏 / 进度提示）
- 错误状态附带"重试"按钮，无需重新输入代码

### 响应式适配

- 4 列 Agent 卡片：大屏 4 列 → 中屏 2 列 → 小屏 1 列
- 代码输入区根据内容自适应高度

### 改动文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `client/src/components/AgentProgressPanel.vue` | 重写 | 流式展示+动画+响应式 |
| `client/src/components/ChatView.vue` | 重写 | Markdown 渲染+TransitionGroup |
| `client/src/components/ChatMessage.vue` | 增强 | 代码高亮 |
| `client/src/components/CodeInput.vue` | 增强 | 自适应高度 |
| `client/src/components/ReviewReport.vue` | 重写 | 翻滚数字+逐条展开 |
| `client/src/composables/useSSE.ts` | 重写 | 支持流式 chunk |
| `client/src/composables/useTypewriter.ts` | 新增 | 打字机效果 |
| `client/src/styles/transitions.css` | 新增 | 过渡动画 |
| `client/src/types/index.ts` | 扩展 | 补充前端类型 |

---

## 第 ⑥ 层：架构加固

### 数据库升级

- sql.js → better-sqlite3（文件持久化）
- 数据库路径可配置：`DB_PATH=.data/review.db`（默认）
- 启动时自动创建 `.data` 目录

### 并发任务控制

- 环境变量 `MAX_CONCURRENT_TASKS=3`
- 超出上限的任务进入内存队列
- 前端排队展示："前面还有 X 个任务"
- 基于代码 hash 的去重（可选）

### API 限流

- `express-rate-limit`：全局 100 req/min，审查接口 10 req/min
- 超限返回 `429 Too Many Requests`

### 健康检查增强

```json
GET /api/health → {
  "status": "ok",
  "uptime": 12345,
  "db": "connected",
  "llm": "healthy",
  "activeTasks": 2
}
```

### 环境配置校验

启动时校验必填环境变量，缺了就报错退出：

- 必填：`LLM_API_KEY`
- 可选（有默认值）：`LLM_MODEL`、`LLM_BASE_URL`、`LLM_PROVIDER`、`PORT`、`DB_PATH`、`MAX_CONCURRENT_TASKS`

### 改动文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `server/src/index.ts` | 增强 | 启动校验+增强健康检查 |
| `server/src/config.ts` | 新增 | 统一配置管理 |
| `server/src/middleware/rateLimiter.ts` | 新增 | 限流中间件 |
| `server/src/db/connection.ts` | 重写 | sql.js → better-sqlite3 |
| `server/src/db/migrate.ts` | 新增 | 迁移脚本 |
| `server/package.json` | 修改 | 替换依赖 |

---

## 实施顺序

```
① 基础设施 → ② LLM 客户端 → ③ 工具真实化 → ④ Agent 引擎 → ⑤ 前端体验 → ⑥ 架构加固
   (铺底)       (核心能力)     (最大改动)       (智能层)       (体验层)       (生产加固)
```

每层完成后可独立验证，确认无误再进入下一层。

---

## 自检清单

- [x] 无 TBD / TODO 占位符
- [x] 六层之间接口清晰，依赖关系明确
- [x] 改动范围完整（每层列出了具体文件和操作）
- [x] 体验优先但兼顾真实性（工具不再是 Mock）
- [x] 每层自包含，可独立验证
