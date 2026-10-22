# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 破坏性变更

- **移除明文口令回退**：`DATABASE_URL` 与 `RABBITMQ_URL` 改为必填，缺失时启动失败并一次性列出全部错误字段；此前缺失会回退到内置的连接串与口令。请检查 `.env` 后再部署。（REQ-03）
- **LLM 默认地址随 provider 推导**：LLM 客户端改为读取 `config.ts` 校验后的配置。`LLM_BASE_URL` 留空时，`LLM_PROVIDER=anthropic` 的请求从此前误发的 `https://api.deepseek.com` 改为 `https://api.anthropic.com`，`LLM_PROVIDER=openai` 改为 `https://api.openai.com`。依赖旧默认值访问 DeepSeek 的部署请显式设置 `LLM_BASE_URL`。（优化方案 P0-5）

### 新增

- 请求级审查配置（REQ-14）：`POST /api/tasks` 接受 `reviewConfig`，可传入自定义要求（≤2000 字）、限定审查维度、按严重度过滤与截断问题数量；配置随任务落库并从语义缓存键中隔离；前端代码输入区新增可折叠「审查设置」。
- GitHub Webhook 最小闭环（REQ-15）：`POST /api/webhooks/github` 校验 HMAC SHA-256 签名，PR `opened` / `synchronize` / `reopened` 时拉取变更文件（扩展名白名单 + 体积上限）创建审查任务，任务完成后把 Markdown 报告回写为 PR 评论。
- API Key 鉴权（REQ-12）：`API_KEYS` 配置后启用，支持 `X-API-Key` 与 `Authorization: Bearer`，SSE 路径支持 `?api_key=`；前端新增统一 HTTP 客户端与「API Key 设置」入口。
- 报告导出（REQ-13）：`GET /api/tasks/:id/report.md` 与 `/report.sarif` 导出 Markdown 与 SARIF 2.1.0，报告页提供导出按钮。
- OpenAPI 文档（REQ-16）：`GET /api/openapi.json` 与 `GET /api/docs`（Swagger UI），请求体 schema 由 zod 校验规则直接生成。
- 提示注入防御与输出脱敏（REQ-10）：新增 `security/prompt-guard.ts`（9 条检测规则、随机 nonce 定界包裹、五类凭据脱敏），五个角色 prompt 增加防注入约束，报告新增 `security` 字段，命中时前端提示。
- ReAct 治理（REQ-11）：相同工具与参数重复调用熔断、单次审查工具调用上限、任务级 token 预算与降级，报告新增 `governance` 字段。
- 配置校验与健康探针（REQ-03、REQ-07）：zod 配置 schema、`/api/health/live` 与 `/api/health/ready`。
- 结构化日志与请求追踪（REQ-05）：pino JSON 日志、`X-Request-Id` 贯穿、HTTP 访问日志。
- 版本化数据库迁移（REQ-09）：`schema_migrations` 表 + advisory lock 的迁移器。
- 容器生产化（REQ-08）：server 镜像非 root + HEALTHCHECK，client 镜像两阶段构建 + nginx-unprivileged 托管。
- 工程化基线（REQ-01、REQ-02）：ESLint flat config、Prettier、EditorConfig、GitHub Actions CI、Dependabot。
- 治理文档：`SECURITY.md`、`CHANGELOG.md`，以及 `CONTRIBUTING.md` 中的分支与提交规范。

### 变更

- 分支模型确立为 `master`（发布线）+ `develop`（集成线），详见 `CONTRIBUTING.md`。
- CI 触发范围由 `master` 扩展为 `master` 与 `develop`（REQ-02 的有意调整）。
- 依赖升级：`express` 4.21 → 5.2.1、`vite` 8.0 → 8.3、`vue-tsc` 3.2 → 3.3、`zod` 4.1 → 4.6、`tsx` 4.19 → 4.23，以及 GitHub Actions（checkout v7、setup-node v7、buildx v4、build-push v7）。
- 前端 `axios` 调用统一收敛到 `client/src/api/http.ts`，不再在各组件拼接 `VITE_API_BASE`。
- `vue/multi-word-component-names` 规则关闭（历史组件命名如此），如需恢复需先重命名组件。
- 配置单一真源（REQ-03，优化方案 P1-5）：嵌入/重排、Langfuse、`ROLE_MODELS` 与 `LLM_ROUTE_<别名>_*`、`MCP_CLIENT_SERVERS`、`RAG_MODE`、`EVAL_JUDGE_MODEL` 纳入 zod schema，各模块统一经 `getConfig()` 读取；`LLM_MAX_CONCURRENCY` 等非法值启动即报错，不再静默得到 `NaN`。ESLint 禁止在 `server/src` 中直接读取 `process.env`（`config.ts`、日志引导默认值、eval CLI 与测试除外）。
- 报告评分统一取报告的综合评分（按维度加权），worker 不再另行按维度平均后落库。

### 修复

- express 5 下 `req.params` 值类型拓宽为 `string | string[]`，`/:id` 路由显式收窄类型（`TaskIdRequest`）。
- 语义缓存键纳入 `reviewConfig`，避免不同审查配置复用同一份报告。
- Webhook 创建的任务此前在未注入发布函数时只入库不入队，会一直停在 pending；现在与手动提交共用 `submitReviewTask`，入队失败时任务标记为失败，接口返回 502 `QUEUE_UNAVAILABLE`。（优化方案 P0-1）
- 任务在收尾瞬间被取消时不再回写 PR 评论：评论改在任务确认进入 completed 之后发送，且不计入任务耗时；缓存命中路径同样如此。（优化方案 P0-2）
- 审查配置的严重度过滤同时作用于各维度结果，按维度查看与 Markdown/SARIF 导出不再包含已过滤的问题；`maxIssues` 仍只截断最终问题清单。（优化方案 P1-2）

### 安全

- 移除明文口令回退（见破坏性变更）。
- 报告输出与规则引擎命中片段不再包含密钥原文。脱敏范围扩展到各维度结果（`agentResults`）与注入检测片段，覆盖 PR 评论、导出与语义缓存回放。（优化方案 P0-4）
- GitHub Webhook 未配置密钥时关闭端点（404）。

## [1.0.0] - 2026-09-14

首个内部版本：多 Agent 协作的 AI 代码审查平台。包含 ReAct 编排、RabbitMQ 任务队列、PostgreSQL 事件回放 + SSE 断线续传、混合 RAG 检索、评测体系与 MCP 双向接入。
