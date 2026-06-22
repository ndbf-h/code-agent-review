# CodeAgentReview — 多智能体代码审查平台

> 状态：设计中 → 待评审
> 目标岗位：Agent 开发实习生
> 工期：1-2 周
> 最后更新：2026-06-22

---

## 一、项目定位

- **项目名**：CodeAgentReview
- **中文名**：多智能体代码审查平台
- **选题方向**：AI Agent 开发实习生
- **核心卖点**：纯 TypeScript 全栈 + 手写 Agent 引擎（ReAct 模式），不依赖 LangChain/LangGraph
- **Demo 场景**：用户粘贴代码 → Orchestrator 拆解为 4 个审查维度 → 4 个专家 Agent 并行审查 → 汇总输出结构化报告

### 选型理由

- 90% 的 Multi-Agent 项目用 Python + LangChain，TS 手写 Agent 引擎辨识度极高
- 手写 Agent 引擎证明对底层原理的理解，面试加分远大于调包
- 部署到 Vercel 可获得公开链接，直接放简历

---

## 二、技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 前端 | Vue 3 (Composition API) + Vite | 国内最主流框架 |
| UI | Element Plus | 成熟稳定的 Vue 3 组件库 |
| 状态管理 | Pinia | Vue 官方推荐 |
| HTTP | Axios | 最常见 HTTP 库 |
| 后端 | Express 4 | 简单可靠 |
| 数据库 | better-sqlite3 | 同步 API，零配置 |
| LLM | Claude API / OpenAI API | 双支持，配置切换 |
| 部署 | Vercel（前端）+ Railway（后端） | 免费额度够用 |

---

## 三、整体架构

```
┌─────────────────────────────────────────────────┐
│                  Vue 3 前端                       │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ 代码输入  │  │ Agent    │  │ 报告展示      │  │
│  │ (Chat)   │  │ 状态流    │  │ (结构化卡片)  │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
├─────────────────────────────────────────────────┤
│              Express API 层                      │
│  POST /api/tasks         创建任务                │
│  GET  /api/tasks/:id     查看状态                │
│  GET  /api/tasks/:id/stream  SSE 实时推送        │
├─────────────────────────────────────────────────┤
│            Agent 引擎（核心，手写）                │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │Orchestrator│ │Agent 实例 │  │ Tool Registry │  │
│  │ 任务拆解   │  │ ReAct循环│  │ Map<string,T> │  │
│  │ 结果汇总   │  │ 记忆管理 │  │ Mock 工具集   │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
│              ┌──────────┐                        │
│              │ LLM Client│  → Claude / OpenAI    │
│              └──────────┘                        │
├─────────────────────────────────────────────────┤
│              SQLite 持久化                        │
│  tasks | agents | messages | tool_calls | reports│
└─────────────────────────────────────────────────┘
```

### 核心设计原则

- Agent 引擎完全手写，不依赖 LangChain
- 每个 Agent 是独立的 ReAct 循环实例，拥有角色定义、可用工具、独立上下文
- Orchestrator 负责拆任务 → 派 Agent → 收集结果 → 汇总输出
- 前端通过 SSE 实时接收每个 Agent 的思考过程

---

## 四、数据模型

### ER 关系

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│   Task   │────→│  Agent   │────→│ Message  │
└──────────┘     └──────────┘     └──────────┘
     │                                 │
     │                                 │
     ▼                                 ▼
┌──────────┐                    ┌──────────┐
│ToolCall  │                    │  Report  │
└──────────┘                    └──────────┘
```

### 表结构

**tasks**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT (UUID) | 主键 |
| title | TEXT | 任务标题 |
| codeSnippet | TEXT | 待审查代码 |
| language | TEXT | 编程语言 |
| status | TEXT | pending/orchestrating/reviewing/summarizing/completed/failed |
| createdAt | TEXT (ISO8601) | 创建时间 |

**agents**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT (UUID) | 主键 |
| taskId | TEXT | 外键 → tasks.id |
| role | TEXT | orchestrator/security/perf/style/logic |
| status | TEXT | idle/thinking/calling_tool/done/error |
| modelName | TEXT | 使用的 LLM 模型 |
| createdAt | TEXT | 创建时间 |

**messages**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT (UUID) | 主键 |
| taskId | TEXT | 外键 → tasks.id |
| agentId | TEXT | 外键 → agents.id（用户消息为 null） |
| role | TEXT | user/agent/system |
| content | TEXT | 消息正文 |
| type | TEXT | user_input/agent_thought/tool_call/tool_result/final_answer |
| createdAt | TEXT | 创建时间 |

**tool_calls**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT (UUID) | 主键 |
| agentId | TEXT | 外键 → agents.id |
| messageId | TEXT | 外键 → messages.id |
| toolName | TEXT | 工具名 |
| input | TEXT (JSON) | 调用参数 |
| output | TEXT (JSON) | 返回结果 |
| createdAt | TEXT | 创建时间 |

**reports**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT (UUID) | 主键 |
| taskId | TEXT | 外键 → tasks.id |
| content | TEXT (JSON) | 报告结构 |
| score | INTEGER | 综合评分 0-100 |
| createdAt | TEXT | 创建时间 |

content 字段 JSON 结构：

```json
{
  "issues": [
    {
      "line": 3,
      "severity": "critical",
      "category": "SQL Injection Risk",
      "message": "User input concatenated into query string.",
      "suggestion": "Use parameterized queries instead."
    }
  ],
  "agentResults": {
    "security": { "issues": [...], "score": 80 },
    "performance": { "issues": [...], "score": 90 },
    "style": { "issues": [...], "score": 75 },
    "logic": { "issues": [...], "score": 85 }
  }
}
```

### 状态流转

```
pending → orchestrating → reviewing → summarizing → completed
                ↓                            ↓
              failed  ←──────────────────────┘
```

---

## 五、Agent 角色与工具集

### Agent 角色定义

| 角色 | systemPrompt 要点 | 可用工具 |
|------|------------------|---------|
| Orchestrator | 代码审查协调者。分析代码，拆成 4 个审查维度，分派给专家 Agent，最后汇总报告。 | decomposeTask, assignAgent, collectResults, generateReport |
| Security Reviewer | 安全审计专家。专注发现 SQL 注入、XSS、敏感信息泄露、不安全的依赖。 | analyzeCode, checkPattern |
| Performance Reviewer | 性能优化专家。关注循环复杂度、冗余查询、N+1 问题、异步处理。 | analyzeCode, checkPattern |
| Style Reviewer | 代码规范专家。检查命名、注释、结构、错误处理是否符合最佳实践。 | analyzeCode, checkPattern |
| Logic Reviewer | 逻辑审查专家。检查边界条件、类型安全、空值处理、异常路径。 | analyzeCode, validateLogic |

### 工具集（全部 Mock）

**编排工具**

| 工具名 | 参数 | Mock 返回 |
|--------|------|----------|
| decomposeTask | code, language | `{ dimensions: ['security','performance','style','logic'], subTasks: [...] }` |
| assignAgent | agentRole, subTask | `{ agentId: 'uuid', assigned: true }` |
| collectResults | taskId | `{ results: [{agentRole, findings:[...]}] }` |
| generateReport | taskId, results | `{ reportId: 'uuid', summary: '...', score: 62 }` |

**审查工具**

| 工具名 | 参数 | Mock 返回 |
|--------|------|----------|
| analyzeCode | code, dimension | `{ issues: [{line, severity, category, message, suggestion}], score: 85 }` |
| checkPattern | code, pattern | `{ matches: [{line, pattern, description}], count: 2 }` |
| validateLogic | code | `{ edgeCases: ['null input','empty array'], covered: [true,false] }` |

### ReAct 循环

每个 Agent 独立运行 ReAct 循环，最大 5 轮：

```
Thought → Action(tool_call) → Observation(tool_result) → Thought → ... → Final Answer
```

实现方式：

```typescript
async function runReActLoop(agent: AgentInstance, maxRounds = 5) {
  const messages = [agent.systemPrompt, ...agent.context]

  for (let round = 0; round < maxRounds; round++) {
    const response = await llmClient.chat(messages, agent.tools)

    if (response.finishReason === 'stop') {
      return response.content  // Final Answer
    }

    if (response.finishReason === 'tool_use') {
      const toolResult = await executeTool(response.toolCall)
      messages.push({ role: 'assistant', content: response })
      messages.push({ role: 'tool', content: toolResult })
      // 继续下一轮
    }
  }
}
```

### 为什么用 Mock 工具

- **跑通流程优先**：先验证 Agent 引擎的编排、协作、通信能力
- **工具接口抽象**：Mock 和真实工具实现同一接口，后续替换零改动
- **面试重点**：面试官关注的是引擎架构，而不是工具集成深度

---

## 六、API 与 SSE 协议

### REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/tasks | 创建审查任务 |
| GET | /api/tasks/:id | 获取任务详情（含 Agent 状态和消息） |
| GET | /api/tasks/:id/stream | SSE 端点，实时推送 Agent 思考过程 |

**POST /api/tasks 请求体：**

```json
{
  "code": "function getUser(id) { ... }",
  "language": "typescript",
  "title": "getUser 函数审查"
}
```

### SSE 事件类型

```
event: orchestrator_start    Orchestrator 开始拆解任务
event: task_decomposed       { dimensions: [...], subTasks: [...] }
event: agent_start           { agentId, role, message }
event: agent_thought         { agentId, role, thought }
event: tool_call             { agentId, role, toolName, input }
event: tool_result           { agentId, role, toolName, output }
event: agent_done            { agentId, role, findings: [...] }
event: orchestrator_summary  Orchestrator 开始汇总
event: report_ready          { reportId, summary, issues: [...] }
event: task_completed        null
event: error                 { message, agentId? }
```

### 为什么选 SSE 而非 WebSocket

- SSE 是单向推送（服务端 → 前端），审查场景前端只需接收，不需要频繁双向通信
- SSE 基于 HTTP，自动重连，实现比 WebSocket 更轻量
- 创建任务走 POST，后续只需接收流，不需要双向通道

---

## 七、UI 设计

### 设计原则

- 简洁专业，无多余装饰
- 左侧竖线标记消息来源
- 时间戳右对齐
- 严重程度用标签区分（Critical / Warning / Suggestion）

### 界面 1 — 初始状态

```
┌────────────────────────────────────────────────────────┐
│  CodeAgentReview                                       │
│  Multi-Agent 代码审查                                   │
│                                                        │
│  ────────────────────────────────────────────────────  │
│                                                        │
│    Language   [TypeScript  ▾]                          │
│                                                        │
│    ┌────────────────────────────────────────────────┐  │
│    │                                                │  │
│    │  function getUser(id) {                        │  │
│    │    const sql = "SELECT * FROM users WHERE id=" │  │
│    │      + id                                      │  │
│    │    return db.query(sql)                        │  │
│    │  }                                             │  │
│    │                                                │  │
│    └────────────────────────────────────────────────┘  │
│                                                        │
│    [Start Review]                                      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### 界面 2 — Agent 工作中

```
┌────────────────────────────────────────────────────────┐
│  CodeAgentReview                                       │
│                                                        │
│  ────────────────────────────────────────────────────  │
│                                                        │
│    You                                            12:03│
│    │ Submitted TypeScript code for review              │
│                                                        │
│    Orchestrator                                   12:03│
│    │ Analyzing code structure...                       │
│    │ Task decomposed into 4 dimensions.                │
│    │ Dispatching reviewers now.                        │
│                                                        │
│    Security Reviewer                              12:04│
│    │ Inspecting SQL injection risks...                 │
│    │   - checkSqlInjection                             │
│    │   - checkDataExposure                             │
│                                                        │
│    Performance Reviewer                           12:04│
│    │ Analyzing query patterns...                       │
│    │   - checkDbQuery                                  │
│                                                        │
│    Style Reviewer                                12:04│
│    │ Reviewing naming and structure...                 │
│    │   - checkNaming                                   │
│                                                        │
│    Logic Reviewer                                12:04│
│    │ Checking boundary conditions...                   │
│    │   - checkBoundary                                 │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### 界面 3 — 审查报告

```
┌────────────────────────────────────────────────────────┐
│  CodeAgentReview                                       │
│                                                        │
│  ────────────────────────────────────────────────────  │
│                                                        │
│    Review Report                                  12:05│
│    │ Overall Score: 62 / 100                           │
│    │                                                   │
│    │ -- Critical --                                    │
│    │ ┌───────────────────────────────────────────────┐ │
│    │ │ Line 3  SQL Injection Risk             HIGH  │ │
│    │ │ User input concatenated into query string.    │ │
│    │ │ Use parameterized queries instead.            │ │
│    │ └───────────────────────────────────────────────┘ │
│    │ ┌───────────────────────────────────────────────┐ │
│    │ │ Line 2  Missing Null Check              HIGH  │ │
│    │ │ Parameter 'id' may be undefined or null.      │ │
│    │ │ Add guard clause at function entry.           │ │
│    │ └───────────────────────────────────────────────┘ │
│    │                                                   │
│    │ -- Warning --                                     │
│    │ ┌───────────────────────────────────────────────┐ │
│    │ │ Line 1  Missing Type Annotation        MEDIUM │ │
│    │ │ Function parameter lacks explicit type.       │ │
│    │ │ Add: function getUser(id: string)             │ │
│    │ └───────────────────────────────────────────────┘ │
│    │                                                   │
│    │ -- Suggestion --                                  │
│    │ ┌───────────────────────────────────────────────┐ │
│    │ │ Line 1  Naming Convention                LOW  │ │
│    │ │ Consider 'getUserById' for clarity.           │ │
│    │ └───────────────────────────────────────────────┘ │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 八、项目目录结构

```
code-agent-review/
├── client/                     # Vue 3 前端 (Vite)
│   ├── src/
│   │   ├── components/
│   │   │   ├── ChatInput.vue         # 代码输入区
│   │   │   ├── ChatMessage.vue       # 单条消息气泡
│   │   │   ├── AgentStatus.vue       # Agent 状态卡片
│   │   │   ├── ReviewReport.vue      # 审查报告卡片
│   │   │   └── ToolCallBadge.vue     # 工具调用标签
│   │   ├── composables/
│   │   │   ├── useSSE.ts             # SSE 连接
│   │   │   └── useChat.ts            # 对话状态管理
│   │   ├── stores/
│   │   │   └── review.ts             # Pinia store
│   │   ├── types/
│   │   │   └── index.ts              # 前端类型
│   │   ├── App.vue
│   │   └── main.ts
│   ├── index.html
│   └── vite.config.js
│
├── server/                     # Express 后端
│   ├── src/
│   │   ├── routes/
│   │   │   └── tasks.ts              # API 路由
│   │   ├── services/
│   │   │   └── taskService.ts        # 任务服务
│   │   ├── agent/                    # 核心：Agent 引擎
│   │   │   ├── orchestrator.ts       # Orchestrator 逻辑
│   │   │   ├── react-loop.ts         # ReAct 循环实现
│   │   │   ├── memory.ts             # 上下文管理（数组，超 5000 token 裁旧）
│   │   │   ├── tool-registry.ts      # 工具注册 Map<string, Tool>
│   │   │   ├── llm-client.ts         # LLM API 客户端
│   │   │   ├── types.ts              # Agent 核心类型
│   │   │   └── roles/                # 角色 prompt 定义
│   │   │       ├── orchestrator.ts
│   │   │       ├── security-reviewer.ts
│   │   │       ├── performance-reviewer.ts
│   │   │       ├── style-reviewer.ts
│   │   │       └── logic-reviewer.ts
│   │   ├── tools/                    # 工具集
│   │   │   ├── index.ts              # 工具注册入口
│   │   │   ├── orchestration.ts      # 编排工具（Mock）
│   │   │   └── review.ts             # 审查工具（Mock）
│   │   ├── db/
│   │   │   ├── schema.ts             # SQLite 建表
│   │   │   └── queries.ts            # 数据库操作
│   │   └── index.ts                  # Express 入口
│   └── tsconfig.json
│
├── shared/                     # 前后端共享类型
│   └── types.ts
│
├── package.json
└── tsconfig.json
```

**核心目录是 `server/src/agent/`**，手写的 Agent 引擎全部在这里，面试重点关注。

---

## 九、开发阶段规划

| 阶段 | 内容 | 预计耗时 |
|------|------|---------|
| 1. 骨架搭建 | 前后端项目初始化、目录结构、TypeScript 配置 | 1 天 |
| 2. Agent 引擎 | ReAct 循环、Tool Registry、LLM Client、角色定义 | 2-3 天 |
| 3. Mock 工具 | 编排工具 + 审查工具实现 | 1 天 |
| 4. 后端 API | Express 路由、SSE 推送、SQLite 持久化 | 1-2 天 |
| 5. 前端界面 | Vue 3 + Element Plus，SSE 对接 | 2-3 天 |
| 6. 联调优化 | 全流程跑通、UI 打磨、错误处理 | 1 天 |

---

## 十、待确认

- [x] 架构设计
- [x] Agent 角色（4 个审查 Agent + 1 个 Orchestrator）
- [x] 工具集（Mock）
- [x] 数据模型
- [x] UI 布局（Chat 对话式）
- [x] 目录结构
- [x] 项目名称（CodeAgentReview）
- [ ] 设计文档最终审批
