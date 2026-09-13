# Code Agent Review

一个基于多 Agent 协作的 AI 代码审查平台。用户可以粘贴代码或从 URL 拉取代码，系统会创建审查任务，通过编排 Agent 分发给安全、性能、风格、逻辑等多个 Reviewer，并用 SSE 实时展示 Agent 思考、工具调用、审查进度和最终报告。

这个项目的目标不是做一个简单的 LLM 聊天壳，而是模拟真实 Code Review 流程：先做规则预扫描，再由编排器规划审查重点，多个 Reviewer 并行分析，最后聚合问题、评分和修复建议。

## 项目亮点

- **多 Agent 审查流程**：包含 `orchestrator`、`security`、`performance`、`style`、`logic` 五类角色，职责拆分清晰。
- **RabbitMQ 任务队列**：API 与 Worker 进程分离，任务经 durable 队列投递，支持延迟重试、死信归档（DLQ）、TTL 重投递与 worker 心跳回收，并发由 consumer prefetch 控制，多 Worker 实例天然分摊。
- **ReAct + Tool Calling**：Agent 可以在推理过程中调用规则检查、复杂度分析、任务分解、结果聚合等工具。
- **实时审查进度 + 断线续传**：审查事件持久化到 PostgreSQL 并经 LISTEN/NOTIFY 实时扇出到 SSE 连接；每帧携带自增 `id`，断线重连后按 `Last-Event-Id` 从断点回放，思考流不重复、状态不回退。
- **RAG 混合检索**：`retrieveCodingGuidelines` 默认走混合管线——BM25（CJK 二元组分词）+ 多语言向量召回（可选，OpenAI 兼容 /embeddings）→ RRF 融合 → 重排（可选），未配置嵌入密钥时自动降级为 BM25 单分支；`RAG_MODE=legacy` 可切回词元打分基线。效果由 `npm run eval -- --suite rag` 的双管线对比报告量化。
- **界面体验**：明暗主题切换、本地化字体（Inter + JetBrains Mono）、聊天式布局（输入区固定底部）与审查阶段时间线，兼顾桌面和移动端。
- **规则引擎降级**：当 LLM 调用失败或结构化输出异常时，系统会回退到本地规则引擎，避免整条审查链路直接中断。
- **任务历史与报告持久化**：审查任务、Agent、消息和报告会写入 PostgreSQL，前端支持查看历史任务与报告详情。
- **URL 抓取安全控制**：支持从 URL 拉取代码，同时限制协议、重定向次数、文件大小和私有地址访问，降低 SSRF 风险。
- **可观测性接口**：提供 Token 使用量、请求次数、Agent 阶段耗时和服务健康检查，方便定位性能和稳定性问题。
- **全栈 TypeScript**：前后端和共享类型统一使用 TypeScript，减少接口字段漂移。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | Vue 3, Vite, TypeScript, Pinia, Vue Router, Element Plus, Axios |
| 后端 | Node.js, Express, TypeScript, pg |
| Agent | 自研 ReAct Loop, Tool Registry, 多角色 Prompt, LLM Structured Output |
| 消息队列 | RabbitMQ 3.13 (amqplib), durable 队列 / publisher confirm / prefetch 并发 / TTL 延迟重试 / DLQ |
| 数据库 | PostgreSQL（含 LISTEN/NOTIFY 实时事件扇出） |
| 通信 | REST API, Server-Sent Events（事件回放 + 续传） |
| 测试 | Vitest, Vue Test Utils, jsdom |
| 工程化 | ESLint/TypeScript Build, 环境变量配置, 并发任务限制 |

## 系统架构

```mermaid
flowchart LR
  User[用户] --> Client[Vue 前端]
  Client -->|创建任务 REST| Server[Express API]
  Client -->|订阅进度 SSE| Stream[任务流接口]

  Server -->|落库 pending + 事件| DB[(PostgreSQL)]
  Server -->|publish confirm| MQ{{RabbitMQ}}

  MQ -->|consume / prefetch| Worker[Worker 进程]
  Worker -->|抢占任务行 FOR UPDATE| DB
  Worker -->|审查事件落库 + 心跳| DB
  DB -->|LISTEN/NOTIFY| Stream

  Worker --> Orchestrator[Orchestrator Agent]

  Orchestrator --> RuleScan[规则预扫描]
  Orchestrator --> ReactLoop[ReAct Loop]
  ReactLoop --> Tools[Tool Registry]
  ReactLoop --> LLM[LLM Provider]

  Orchestrator --> Security[Security Reviewer]
  Orchestrator --> Performance[Performance Reviewer]
  Orchestrator --> Style[Style Reviewer]
  Orchestrator --> Logic[Logic Reviewer]

  Security --> Aggregator[结果聚合]
  Performance --> Aggregator
  Style --> Aggregator
  Logic --> Aggregator
  Aggregator --> Report[审查报告]
  Report --> DB
```

任务失败且重试额度未耗尽时，Worker 把消息转入 TTL 延迟队列（默认 30s），到期经死信路由回到主队列重新投递；额度耗尽则归档到 `review.task.dlq` 并标记任务失败。Worker 心跳超时（默认 120s）由 sweeper 回收重新入队，避免崩溃任务悬挂。

## 核心流程

1. 用户提交代码、语言和任务标题。
2. API 创建任务（`pending`）与 Agent 实例，写入 `task_queued` 事件，并把消息发布到 RabbitMQ（等待 broker 确认后才返回 201）。
3. 前端打开 SSE 连接；连接时服务端先发状态快照，再从事件表按序号回放历史事件，之后实时推送——SSE 只负责展示，不再触发执行。
4. Worker 从队列消费消息（prefetch 限制并发），用 `SELECT ... FOR UPDATE` 原子抢占任务行（幂等：重复投递会被自动吸收），执行期间持续上报心跳。
5. 编排器先执行代码统计和规则预扫描，识别高风险维度。
6. `orchestrator` 使用 ReAct Loop 和工具调用生成审查计划。
7. 安全、性能、风格、逻辑 Reviewer 并行执行审查。
8. 每个 Reviewer 优先使用 LLM 分析，失败时回退到规则引擎。
9. 系统聚合问题、评分、Agent 结果和降级状态，生成最终报告；所有过程事件（思考流按 300ms 合并）写入 `task_events` 表。
10. 任务失败且重试额度未耗尽时经 TTL 队列延迟重试；耗尽则进入 DLQ 并标记失败。报告、消息和任务状态持久化到 PostgreSQL，支持历史查看。

## 目录结构

```text
code-agent-review/
├── client/                  # Vue 3 前端
│   └── src/
│       ├── components/      # 审查输入、报告、进度、指标、Diff 等组件
│       ├── composables/     # SSE、聊天状态、打字机效果
│       ├── router/          # 页面路由
│       ├── stores/          # Pinia 状态管理
│       ├── views/           # 首页、历史页、报告页
│       └── utils/           # 语言检测等工具
├── server/                  # Express 后端
│   └── src/
│       ├── agent/           # ReAct Loop、编排器、LLM 客户端、Agent 记忆
│       ├── db/              # PostgreSQL 连接、事务、建表和查询
│       ├── middleware/      # 限流中间件
│       ├── queue/           # RabbitMQ 会话/拓扑、生产者、消费者、sweeper、事件汇聚
│       ├── routes/          # 任务、SSE、指标、URL 抓取接口
│       ├── services/        # 任务服务、事件服务（LISTEN/NOTIFY 扇出）
│       ├── tools/           # Agent 工具和规则引擎
│       ├── utils/           # 信号量、URL 安全检查等通用工具
│       ├── index.ts         # API 进程入口
│       └── worker.ts        # Worker 进程入口（消费任务队列）
├── shared/                  # 前后端共享 TypeScript 类型
├── .env.example             # 环境变量模板
└── package.json             # 根脚本
```

## 快速开始

### 方式一：Docker Compose 一键启动

```bash
cp .env.example .env
```

编辑 `.env`，至少填写你的 `LLM_API_KEY`：

```env
LLM_API_KEY=your-api-key-here
```

启动完整环境：

```bash
docker compose up --build
```

Docker Compose 会启动：

- `db`：PostgreSQL 数据库，数据持久化到 Docker volume。
- `rabbitmq`：RabbitMQ 3.13（含管理 UI 插件），任务队列与事件驱动的核心。
- `server`：Express API 进程，只负责任务创建、SSE 订阅与查询，默认暴露 `http://localhost:3001`。
- `worker`：任务执行进程，消费 RabbitMQ 队列并运行多 Agent 审查。
- `client`：Vue 前端预览服务，默认暴露 `http://localhost:5173`。

PostgreSQL 容器对宿主机暴露为 `localhost:5433`，避免和本机已有的 `5432` 端口冲突；后端容器内部会通过 `db:5432` 访问数据库。RabbitMQ 暴露 `5672`（AMQP）与 `15672`（管理 UI）。

启动完成后访问：

- 前端：http://localhost:5173
- 后端：http://localhost:3001
- 健康检查：http://localhost:3001/api/health
- RabbitMQ 管理界面：http://localhost:15672 （账号 `review` / 密码 `review`）

停止服务：

```bash
docker compose down
```

如果需要同时删除数据库数据：

```bash
docker compose down -v
```

### 方式二：本地开发启动

#### 1. 安装依赖

```bash
npm install
npm run install:all
```

#### 2. 准备 PostgreSQL 与 RabbitMQ

本地需要先启动 PostgreSQL 与 RabbitMQ（直接用 compose 里的基础设施服务最省事）：

```bash
docker compose up -d db rabbitmq
```

创建数据库：

```sql
CREATE DATABASE code_agent_review;
```

默认连接串：

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/code_agent_review
RABBITMQ_URL=amqp://review:review@localhost:5672/
```

#### 3. 配置环境变量

复制环境变量模板：

```bash
cp .env.example .env
```

填写 LLM 配置：

```env
LLM_API_KEY=your-api-key-here
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat
LLM_PROVIDER=openai

PORT=3001
DATABASE_URL=postgres://postgres:postgres@localhost:5432/code_agent_review
RABBITMQ_URL=amqp://review:review@localhost:5672/
VITE_API_BASE=http://localhost:3001/api
LOG_LEVEL=DEBUG
LLM_MAX_RETRIES=3
MAX_CONCURRENT_TASKS=3
```

`LLM_PROVIDER=openai` 表示使用 OpenAI 兼容格式，适合 DeepSeek、OpenAI 兼容网关等服务。也可以切换为 `anthropic`，用于 Claude 格式接口。

#### 4. 启动开发环境

```bash
npm run dev
```

默认地址：

- 前端：http://localhost:5173
- 后端：http://localhost:3001
- 健康检查：http://localhost:3001/api/health

## 常用脚本

### 根目录

```bash
npm run dev
npm run dev:server
npm run dev:client
npm run install:all
```

### 后端

```bash
cd server
npm run dev
npm run build
npm run start
npm test
```

### 前端

```bash
cd client
npm run dev
npm run build
npm test
```

## API 概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/tasks` | 创建任务并发布到 RabbitMQ 队列（队列不可用时返回 502） |
| `GET` | `/api/tasks` | 获取任务列表（支持 `status` 过滤） |
| `GET` | `/api/tasks/:id` | 获取任务详情、Agent、消息和报告 |
| `GET` | `/api/tasks/:id/stream` | 订阅事件流：状态快照 + 按 `Last-Event-Id`（或 `?after=`）回放 + 实时推送 |
| `POST` | `/api/tasks/:id/fix` | 基于报告问题生成修复后的代码 |
| `POST` | `/api/tasks/fetch-url` | 从 URL 抓取代码文本 |
| `GET` | `/api/metrics` | 获取 Token、请求数和 Agent 耗时指标 |
| `POST` | `/api/metrics/reset` | 重置指标计数器 |
| `GET` | `/api/health` | 服务健康检查 |

## SSE 事件

审查过程中，前端会收到一系列事件，用于实时渲染 Agent 进度：

| 事件 | 说明 |
| --- | --- |
| `task_state` | 连接建立时的任务状态快照（不占序号；排队中/执行中/终态） |
| `task_queued` | 任务已创建并进入队列 |
| `task_retrying` | 任务失败后即将重试，或执行进程心跳丢失被重新入队 |
| `orchestrator_start` | 编排器开始分析代码 |
| `agent_start` | 某个 Reviewer 开始审查 |
| `thinking_token` | LLM 流式思考片段（服务端按 300ms 窗口合并后下发） |
| `agent_thought` | Agent 推理摘要 |
| `tool_call` | Agent 调用工具 |
| `tool_result` | 工具调用返回 |
| `agent_done` | 单个 Reviewer 完成 |
| `orchestrator_summary` | 编排器开始聚合结果 |
| `report_ready` | 最终报告已生成 |
| `task_completed` | 任务完成 |
| `error` | 任务或 Agent 发生错误（带 `agentId` 表示单个审查员失败，不带则为任务级终态） |

> 传输可靠性：服务端每 20 秒发送心跳注释（`: ping`），防止代理按空闲超时断开长连接。每帧事件携带自增 `id`，浏览器自动重连时通过 `Last-Event-Id` 请求头、手动重连时通过 `?after=` 查询参数从断点回放，客户端按序号去重，保证思考流不重复、状态不回退。前端断线后按指数退避自动重连（最多 8 次），重连仍失败时会通过任务详情接口同步真实状态。

## 数据模型

项目核心数据实体包括：

- `Task`：审查任务，保存代码、语言、标题、状态、创建时间、失败次数（`attempt_count`）和执行心跳（`heartbeat_at`）。
- `Agent`：任务下的 Agent 实例，记录角色、模型和状态。
- `Message`：Agent 推理、工具调用和最终回答的消息记录。
- `TaskEvent`：审查过程事件日志（`task_events` 表，自增 `seq`），SSE 回放与跨进程实时扇出的数据源，INSERT 时经触发器 `pg_notify` 通知 API 实例。
- `Report`：最终审查报告，包含评分和结构化问题列表。
- `Issue`：单个代码问题，包含行号、严重级别、类别、描述和建议。

## 任务队列与 RabbitMQ 运维

### 队列拓扑

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `review.task` | direct exchange | 任务主交换机，路由键 `ready` |
| `review.task.ready` | durable queue | 待执行任务（worker 消费，prefetch = `MAX_CONCURRENT_TASKS`） |
| `review.task.retry` | durable queue | TTL 延迟重试队列（默认 30s），无消费者，消息到期死信回主交换机 |
| `review.task.dlx` / `review.task.dlq` | exchange / queue | 死信归档，重试耗尽的任务在这里供人工审计 |

### 可靠性机制

- **publisher confirm**：任务创建在 broker 确认落盘后才返回 201，broker 缺席时返回 502 `QUEUE_UNAVAILABLE`。
- **消费幂等**：worker 消费到消息后先用 `SELECT ... FOR UPDATE` 抢占任务行，重复投递/补偿重发都会被自动吸收，不会重复执行。
- **at-least-once + 兜底对账**：worker 崩溃时未 ack 消息由 broker 重投；心跳超时（`TASK_HEARTBEAT_STALE_MS`，默认 120s）的任务由 sweeper 重置回队列；长时间 pending 的任务由 sweeper 补偿性重发，覆盖“落库成功但消息丢失”的窗口。sweeper 同时运行在 API 和 worker 进程中（操作幂等），worker 全部下线时回收逻辑依然可用。
- **优雅关闭**：worker 收到 SIGTERM 后停止取新消息，等待在途任务收尾（上限 25s），超时后未 ack 消息自动重排队。

### 常用操作

- 管理界面 http://localhost:15672（`review` / `review`）：查看队列深度、消费者、消息速率；`review.task.dlq` 中的消息可手动 get 后排查失败原因。
- 扩容：`docker compose up -d --scale worker=3`，多 worker 共享队列自动分摊（注意每实例都受 prefetch 限制，总并发 = 实例数 × `MAX_CONCURRENT_TASKS`）。
- 修改重试延迟 `TASK_RETRY_DELAY_MS`：RabbitMQ 队列参数创建后不可变，需先删除 `review.task.retry` 队列再重启服务。
- 排查卡死任务：`GET /api/tasks?status=orchestrating` 查看是否有心跳超时的任务（sweeper 每 60s 自动回收一次）。

### 已知限制

- `/api/metrics` 的 Token 用量与 Agent 耗时是进程内计数器，LLM 调用发生在 worker 进程，API 进程的该面板不再反映真实消耗；后续可落库聚合或由 worker 暴露端点。
- 限流器仍是单实例内存态（按进程计数），多副本部署需换集中式存储。

## 测试

运行后端测试：

```bash
cd server
npm test
```

运行前端测试：

```bash
cd client
npm test
```

## 评测体系

项目内置三类评测器，用于给每次优化（RAG 升级、模型路由、prompt 调整）提供 before/after 数据：

```bash
cd server
npm run eval -- --suite rag                 # RAG 检索评测（零 LLM 成本，秒级）
npm run eval -- --suite review --limit 5    # 审查质量评测冒烟
npm run eval -- --suite review              # 全量 48 样本（约 30 分钟，deepseek 约 ¥3~8）
npm run eval -- --suite judge --from <review报告.json>   # LLM-as-Judge 复评
```

- **数据集**：`evals/datasets/rag.queries.jsonl`（24 条查询，五类：英文精确/英文转述/纯中文/代码片段/维度过滤）、`code-review.golden.jsonl`（48 个样本三层分布：easy 20 / tricky 16 / adversarial 12——对抗层在代码注释中内嵌 prompt injection，考察注入抵抗力）。
- **指标**：RAG 的 Recall@5 / MRR / 零结果率；审查的期望问题召回率（总体/分层/分维度）、规则引擎降级率（fallback）、疑似注入服从数；judge 的 coverage / precision / actionability（0-10）及与确定性匹配的分歧样本。
- **报告**：`evals/reports/<日期>-<套件>.md`（人读）+ `.json`（程序可 diff，后续 CI 门禁的数据源）。
- **已知设计限制**：审查评测串行执行（延迟统计为模块级单例）；期望问题匹配基于类目全等 + 关键词子串，中文类目措辞差异需靠 keyword 兜底；judge 与生产同供应商存在自我偏好风险，可用 `EVAL_JUDGE_MODEL` 指定其他模型。
- **成本控制**：`--limit N` 冒烟、`--tier easy` 分层运行；评测直调 runReviewTask 不经队列，不污染任务历史。

当前 baseline（词元打分检索）：Recall@5 75%，其中中文查询 0% 召回——这是 P1 混合检索（pgvector + BM25 + 重排）的改进起点。审查质量基线（deepseek-chat，48 样本）：期望问题召回率 81.5%、规则引擎降级率 0%、疑似注入服从 0；最弱维度为 logic（63.2%，竞态/缺 await 类细微问题）。

当前测试覆盖重点：

- LLM 客户端结构化输出与重试逻辑
- Tool Registry 注册与调用
- 本地规则引擎匹配
- URL 安全检查
- 队列消费决策（任务抢占、重试额度）与并发信号量
- 前端 SSE 事件序号去重与断线续传

## 安全设计

项目已经加入一些面向生产环境的安全控制：

- 全局请求限流和任务接口限流。
- URL 抓取仅允许 `http` 和 `https`。
- URL 抓取限制重定向次数和响应大小。
- DNS 解析后检查私有地址、回环地址、链路本地地址、保留地址和组播地址。
- LLM 调用配置通过环境变量注入，避免写死密钥。
- LLM 失败时使用规则引擎降级，减少外部服务不稳定带来的影响。

仍需注意：应用层 URL 校验无法完全替代生产环境的网络出口策略。如果部署到公网，建议结合防火墙、容器网络策略或代理层限制，进一步降低 DNS Rebinding 等风险。

## MCP 接入

项目实现了 MCP（Model Context Protocol）双向接入：既作为 **MCP Server** 对外暴露审查工具，也作为 **MCP Client** 挂载外部工具。

### 作为 MCP Server（对外暴露）

API 进程在 `/mcp` 提供 Streamable HTTP 端点（无状态模式）。外部 Agent 客户端（Claude Code、Cursor 等）可以直接调用本平台的 11 个审查工具：

| 工具 | 用途 | 只读 |
| --- | --- | --- |
| `analyzeCode` | 指定维度的问题分析（安全/性能/规范/逻辑） | ✅ |
| `decomposeTask` | 四维度预扫描 + 评分 + 审查策略建议 | ✅ |
| `checkPattern` | 按模式检查（sql_injection/xss/naming/null_check 等） | ✅ |
| `checkComplexity` | 圈复杂度/嵌套深度/热点函数 | ✅ |
| `validateSyntax` | 语法校验（JS/TS 走 AST） | ✅ |
| `applyFixes` | 基于问题清单生成修复代码（走 LLM，有成本） | ❌ |
| `retrieveCodingGuidelines` | 混合检索编码规范知识库 | ✅ |
| `assignAgent` / `collectResults` / `generateReport` / `readFile` | 审查编排辅助 | ✅ |

Claude Code 接入：在项目目录创建 `.mcp.json`：

```json
{
  "mcpServers": {
    "code-agent-review": {
      "type": "http",
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

之后在 Claude Code 中即可让 Agent 调用 `analyzeCode` 等工具审查代码。`applyFixes` 标注了 `readOnlyHint: false`，客户端会按需确认调用。

### 作为 MCP Client（挂载外部工具）

配置 `MCP_CLIENT_SERVERS` 环境变量（alias=url 或纯 URL，逗号分隔），server/worker 启动时会连接外部 MCP Server，把远端工具以 `mcp_<别名>_<工具名>` 注册进工具注册中心——orchestrator 的 ReAct 循环无需改动即可使用外部工具：

```env
MCP_CLIENT_SERVERS=self=http://server:3001/mcp, filesystem=http://mcp-filesystem:3002/mcp
```

连接失败仅告警不阻塞启动。安全边界：11 个内置工具全部无写操作（不写 DB/文件系统），唯一带副作用的 `applyFixes` 仅调用 LLM 生成代码建议、不落盘。

## 可观测性

后端暴露 `/api/metrics`，用于查看：

- Prompt Token、Completion Token 和总 Token 使用量。
- LLM 请求次数。
- 预扫描、编排、Reviewer、报告生成等阶段耗时。
- 服务运行时间。
- **任务级聚合**（来自 `task_metrics` 落库，跨进程真实数据）：最近 24h/7d 的执行次数、成功率、降级次数、token 总量、平均/P99 耗时，以及最近失败任务清单——回答"一天跑多少任务、失败率多少、花了多少 token"。

全链路追踪（Langfuse，可选）：

```bash
docker compose --profile observability up -d   # 拉起 Langfuse v3 自托管栈
```

首次启动后在 http://localhost:3000 创建组织与项目，生成 API 密钥填入 `.env`（`LANGFUSE_PUBLIC_KEY/SECRET_KEY`）并重启 server/worker。此后每次审查任务都会生成 task → reviewer → LLM generation 层级的 trace（含每步 token 用量与模型），可在 UI 中按任务钻取。未配置密钥时系统运行在纯计数模式，指标落库不受影响。

后端还提供结构化日志模块，可通过 `LOG_LEVEL` 控制输出级别：

```env
LOG_LEVEL=DEBUG
```

可选值包括 `DEBUG`、`INFO`、`WARN`、`ERROR`。

## 生产化改进方向

这个项目已经具备比较完整的全栈闭环，但如果要进一步接近生产级，可以继续补齐：

- **跨实例指标聚合**：Token 用量 / Agent 耗时目前是进程内计数器，可迁移到数据库或 Prometheus 指标。
- **集中式限流**：限流器目前按进程计数，多副本部署需迁移到 Redis 等集中存储。
- **部署方案**：当前已提供 Docker Compose 本地部署，后续可补充镜像发布、反向代理、HTTPS 和 CI/CD 自动部署。
- **权限系统**：增加登录、用户隔离、API Key 管理和审查记录权限控制。
- **更完整的 CI**：在 GitHub Actions 中运行前端构建、后端构建、单元测试和类型检查。
- **E2E 测试**：使用 Playwright 覆盖创建任务、流式审查、查看报告和历史记录。
- **报告导出**：支持 Markdown、PDF 或 HTML 格式的审查报告导出。
- **代码仓库接入**：支持 GitHub/GitLab Pull Request 级别审查，而不只是粘贴代码。

## 面试讲解重点

如果把这个项目用于实习生求职，可以重点讲这几件事：

1. **为什么不用单 Agent**：多 Agent 把审查维度拆开，能让安全、性能、风格、逻辑各自拥有不同 Prompt 和工具上下文。
2. **为什么引入 RabbitMQ、API 与 Worker 分离**：任务耗时数分钟且烧 LLM token，需要排队（prefetch 并发控制）、失败重试（TTL 延迟队列）、死信归档（DLQ）和崩溃恢复（心跳 + sweeper 对账）；消费幂等用数据库行锁抢占实现，at-least-once 语义下重复投递无害。
3. **为什么 SSE 事件不走 RabbitMQ**：每个 SSE 连接订阅一个任务，为每连接建 MQ 消费者是反模式；实时扇出用 PG LISTEN/NOTIFY + 事件表回放，MQ 只负责任务流——两种消息系统的职责边界。
4. **SSE 断线续传如何保证不重不乱**：事件表自增序号 + 服务端回放期间缓冲实时事件 + 客户端按序号去重。
5. **如何保证 LLM 不稳定时系统仍可用**：通过重试、结构化输出校验和规则引擎降级保证任务能完成。
6. **怎么继续生产化**：跨实例指标聚合、集中式限流、CI、权限系统和更完整的可观测性。

## 当前状态

项目适合作为“具备生产化思考的 AI 代码审查平台”展示。它已经覆盖前端交互、后端 API、数据库持久化、实时通信、LLM 集成、Agent 编排、规则引擎、测试和安全边界等能力。

对于实习生求职来说，这个项目的优势在于：不只是完成页面和接口，而是能讲清楚复杂异步任务、AI 工程落地、系统可靠性和安全边界。
