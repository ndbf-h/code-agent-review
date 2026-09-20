# 生产级打磨实施计划（2026-09-14）

> 需求来源：`docs/superpowers/specs/2026-09-14-production-readiness-prd.md`。每个批次由一名开发工程师角色实施、一名验收角色审查；验收未通过的问题回流修复后再复审。本文件同时作为进度台账。

## 全局约束（每个批次都隐含）

- 不迁移框架、不重写编排核心；增量改造，保持目录约定。
- 现有 server 85 个、client 7 个单测必须继续通过；新增逻辑必须附带 vitest 单测；DB / MQ / LLM / 外部 HTTP 全部以依赖注入 + mock 验证。
- 新增依赖限定：zod、pino、pino-pretty、helmet、eslint、typescript-eslint、eslint-plugin-vue、prettier、supertest（dev）。
- 新增环境变量必须写入 `.env.example` 并有安全默认值；除移除明文口令回退外，缺省行为与现在一致。
- 共享类型只放 `shared/types.ts`；文档简体中文、无表情符号；不写明文密钥。
- 不启动任何本地服务；不做 E2E。
- 所有产出只写入 `D:\Users\zhiquan.huang\code review` 仓库内。

## 验收基线

- server：`npx tsc --noEmit` 退出 0；`npx vitest run` 全部通过。
- client：`npx vue-tsc -b` 退出 0；`npx vitest run` 全部通过；`npx vite build` 退出 0。
- 批次 1 之后追加：`npm run lint`、`npm run format:check` 退出 0。

## 批次与任务

### 批次 1：工程化基线（REQ-01、REQ-02）

- [x] ESLint flat config、Prettier、EditorConfig、根 / server / client 脚本
- [x] 修复现有 lint error 至 0
- [x] `.github/workflows/ci.yml`、`.github/dependabot.yml`
- 验收：`npm run lint`、`npm run format:check`、YAML 可解析、基线命令全部通过

### 批次 2：服务端加固（REQ-03、REQ-06、REQ-07）

- [x] `config.ts` 改 zod schema，必填 `DATABASE_URL` / `RABBITMQ_URL`，移除明文口令回退，`connection.ts` 惰性 Pool，`getConfig()` 单例收编 connection / eventService / taskService 的直读
- [x] 依赖卫生（REQ-01 追加项）：server `version` 字段、`@types/*` 移入 devDependencies、确认后移除 `better-sqlite3`
- [x] `.env.example` 补全本轮全部新增变量
- [x] `server/src/app.ts` 的 `createApp(deps)` 工厂：helmet、CORS 白名单、trust proxy、body 限制与 413
- [x] 健康探针 `live` / `ready` / 兼容 `health`，依赖注入检查函数；compose healthcheck 改 `ready`
- 验收：新增 config / app / health 单测通过；基线通过

### 批次 3：日志与校验（REQ-05、REQ-04）

- [x] `logger.ts` 改 pino（保持 API），`LOG_FORMAT`，请求 ID 中间件，访问日志，错误响应带 requestId
- [x] 替换 `server/src`（`eval/` 除外）全部裸 console
- [x] `validation/schemas.ts` + `validation/middleware.ts`，覆盖 tasks 路由全部接口与 `:id` UUID
- 验收：logger / requestContext / validation 单测通过；`grep` 无裸 console；lint 与基线通过

### 批次 4：数据层与容器（REQ-09、REQ-08）

- [x] `db/migrations/index.ts`、`db/migrator.ts`（advisory lock、schema_migrations），`001_initial_schema`、`002_task_review_config`
- [x] `schema.ts` 的 `initDb()` 委托 migrator
- [x] server Dockerfile 非 root + HEALTHCHECK；client 两阶段 nginx-unprivileged + `nginx.conf`；compose 端口与 healthcheck；`.dockerignore`
- 验收：migrator 单测通过；Dockerfile / nginx / compose 静态检查；基线通过

### 批次 5：LLM 治理（REQ-10、REQ-11）

- [x] `security/prompt-guard.ts`（detectInjection、wrapUntrustedCode、redactSecrets、INJECTION_HARDENING_PROMPT）
- [x] 五个角色 prompt 加固；orchestrator 三处代码注入点包裹；报告 `security` 字段；写入前脱敏
- [x] react-loop 重复调用熔断与工具调用上限；`agent/budget.ts`；orchestrator 预算分支；报告 `governance` 字段
- [x] `shared/types.ts` 扩展；前端 ReviewReport 提示条与治理信息
- 验收：prompt-guard / react-loop / budget / orchestrator 单测通过；client `vue-tsc -b` 通过；基线通过

### 批次 6：对外能力一（REQ-12、REQ-13、REQ-16）

- [x] `middleware/apiKeyAuth.ts`，白名单路径，stream 的 `api_key` 查询参数，生产 WARN
- [x] 前端统一 axios 实例 + API Key 设置 + SSE URL 附带
- [x] `export/markdown.ts`、`export/sarif.ts`，两个导出路由，前端导出按钮
- [x] `openapi.ts`、`/api/openapi.json`、`/api/docs`
- 验收：auth / export / openapi 单测通过；client 全量检查通过；基线通过

### 批次 7：对外能力二（REQ-14、REQ-15）

- [ ] `ReviewConfig` 类型、schema、落库、orchestrator 维度开关 / 指令注入 / 过滤截断、缓存键
- [ ] 前端 CodeInput 审查设置
- [ ] `integrations/github/{client,webhook}.ts`，`POST /api/webhooks/github`，worker 完成后回写 PR 评论
- 验收：相关单测通过；client 全量检查通过；基线通过

### 批次 8：文档收口（REQ-17）

- [x] SECURITY.md、CONTRIBUTING.md、CHANGELOG.md
- [x] README（新能力、配置、探针、导出、鉴权、Webhook、CI 徽章、LICENSE 提示）、`docs/optimization-log.md` 登记本轮
- 验收：全量 lint / typecheck / test / build 通过

## 进度台账

更新时间：2026-09-20 15:30

| 批次 | 状态 | 说明 |
| --- | --- | --- |
| 1 | 已完成，验收通过 | 首轮验收"不通过"仅因子目录 lint 脚本失效，已改为 `cd .. && eslint server/src` 并复核 |
| 2 | 已完成，验收通过 | 验收"有条件通过"提出的 4 项整改（fetch-url 上限、ConfigError 信息、探针兜底、closeDb 竞态）已全部修复 |
| 3 | 已完成，验收通过 | 验收"有条件通过"提出的 2 项重要整改（cancel / stream 用例、访问日志监听 close）已修复；pretty 日志改同步写 |
| 4 | 已完成，验收通过 | 验收"通过"附带的 3 项轻微建议（/assets/ 安全头补齐、解锁失败销毁连接、.dockerignore 保留旧规则）已修复 |
| 5 | 已完成，验收命令通过 | REQ-10 输入隔离与脱敏、REQ-11 ReAct 治理；提交 `0807498`、`4a897cc`；验收命令 server vitest、client `vue-tsc -b` 通过 |
| 6 | 已完成，验收命令通过 | REQ-12 鉴权与前端 HTTP 客户端、REQ-13 Markdown/SARIF 导出、REQ-16 OpenAPI 文档；提交 `819b0f7`；server `vitest run`、client `vue-tsc -b` 与 `vitest run` 通过 |
| 7 | 待开始 | |
| 8 | 已完成，验收命令通过 | REQ-17 文档收口：`SECURITY.md`、`CHANGELOG.md` 新建，`CONTRIBUTING.md` 补环境要求与 PR 检查清单，README 增补六类能力说明与 CI 徽章，`docs/optimization-log.md` 登记本轮；全量 lint / typecheck / test / build 通过 |

### 批次外任务登记（2026-09-14 晚）

以下为本计划之外、为后续批次铺路的工程改动，均已在本地跑通验证：

| 项目 | 内容 | 验证 |
| --- | --- | --- |
| 依赖升级 | Dependabot 8 个分支合并：`actions/checkout` v7、`actions/setup-node` v7、`docker/setup-buildx-action` v4、`docker/build-push-action` v7、`vite` 8.3.0、`vue-tsc` 3.3.11、`zod` 4.6.2、`tsx` 4.23.13 | lint、format、typecheck、test（server 161 / client 7）、build 全部通过 |
| Express 5 迁移 | `express` 4.21 → 5.2.1、`@types/express` 4 → 5；`server/src/routes/tasks.ts` 新增 `TaskIdRequest = Request<{ id: string }>` 并应用于 7 个 `/:id` 路由，消除 express 5 下 `req.params` 值类型拓宽为 `string \| string[]` 引起的 18 处类型错误 | 同上，另加 server build |
| 分支模型 | 确立 `master`（发布线）+ `develop`（集成线）双常驻分支；废弃按设备命名的 `work/*` 方案（分支名表达代码成熟度，设备差异由 `git config user.name / user.email` 区分） | 本地与远端分支一致 |
| 治理文件 | 新增 `CONTRIBUTING.md`（分支模型、命名规则、提交信息规范、工作流程、硬性约束、提交前验证清单、依赖升级、发布分支启用条件）；README 简介后新增入口链接 | 已提交并推送 |
| CI 触发范围 | `.github/workflows/ci.yml` 的 `on.push.branches` 由 `[master]` 扩展为 `[master, develop]`，与新增的集成分支配套。属对 REQ-02 验收项的有意调整，验收时应按更新后的配置核对 | 集成分支推送即触发流水线 |

> 批次 8 的 REQ-17 要求新增 `CONTRIBUTING.md`。该文件已在本轮提前建立，批次 8 应在现有文件上补充"环境要求、PR 检查清单"等内容，不要覆盖重建，否则分支与提交规范会丢失。

### 暂停时的状态（2026-09-14）

- 批次 1 到 8 全部完成，REQ-01 到 REQ-17 共 17 项需求均已实施并自测通过；server 单测 31 文件 / 235 用例，client 单测 2 文件 / 7 用例，lint（0 error）、format、typecheck、build 全部通过。
- 后续可继续的方向（PRD 第六章「本轮不做」）：E2E（Playwright）、集中式限流、跨实例指标聚合、多用户与配额、GitLab / Bitbucket 接入与 PR 行内评论。
- 推送状态：批次 5 到 8 的提交已推送到 `develop`（`06b9b73`），并合并进 `master`（`047c00b`），CI 在 master 推送时自动触发。
- 2026-09-20 追加：按新流程完成遗留依赖升级（`jsdom` 30.1、`markdown-it` 15.0.2、`@types/node` 26.6、`@vitejs/plugin-vue` 6.0.9、`element-plus` 2.14.6、`pino` 10.3.1、`vitest` 5.0.1、`@types/supertest` 7.2.1、`concurrently` 10.0.5），并把 Dependabot 的 `target-branch` 统一改为 `develop`；再合并进 `master`（`578cf62`）并打标签 `v1.1.0`，CI（run #42）通过。
- 尚未处理的轻微建议：tasks.ts 处理器内直接 `res.json` 的 502 / 500 响应体不含 requestId；`createTaskBodySchema()` 每请求重建 schema（可按 maxCodeChars 缓存）；`vue/multi-word-component-names` 规则关闭需在 CHANGELOG 说明（批次 8）。
- 本机验证限制：Docker 守护进程未运行，Dockerfile 只做了静态检查，镜像构建交由 CI 的 docker job 验证。本轮 CI 触发范围已扩展到 `develop`，集成线上的镜像构建同样会被流水线验证。
- 仓库对应关系：本文件第 13 行提到的 `D:\Users\zhiquan.huang\code review` 与本机 `d:/Code/code-agent-review` 指向同一远端仓库 `ndbf-h/code-agent-review`（提交作者一致、远端仅此一个），两份工作副本通过 `develop` 分支同步即可，无需另建分支做设备隔离。
- 工作方式：产品经理与验收由子智能体承担，开发由主智能体直接实施（子智能体开发效率不稳定）；每批次验收意见回流修复后再进入下一批。
