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

- [ ] `security/prompt-guard.ts`（detectInjection、wrapUntrustedCode、redactSecrets、INJECTION_HARDENING_PROMPT）
- [ ] 五个角色 prompt 加固；orchestrator 三处代码注入点包裹；报告 `security` 字段；写入前脱敏
- [ ] react-loop 重复调用熔断与工具调用上限；`agent/budget.ts`；orchestrator 预算分支；报告 `governance` 字段
- [ ] `shared/types.ts` 扩展；前端 ReviewReport 提示条与治理信息
- 验收：prompt-guard / react-loop / budget / orchestrator 单测通过；client `vue-tsc -b` 通过；基线通过

### 批次 6：对外能力一（REQ-12、REQ-13、REQ-16）

- [ ] `middleware/apiKeyAuth.ts`，白名单路径，stream 的 `api_key` 查询参数，生产 WARN
- [ ] 前端统一 axios 实例 + API Key 设置 + SSE URL 附带
- [ ] `export/markdown.ts`、`export/sarif.ts`，两个导出路由，前端导出按钮
- [ ] `openapi.ts`、`/api/openapi.json`、`/api/docs`
- 验收：auth / export / openapi 单测通过；client 全量检查通过；基线通过

### 批次 7：对外能力二（REQ-14、REQ-15）

- [ ] `ReviewConfig` 类型、schema、落库、orchestrator 维度开关 / 指令注入 / 过滤截断、缓存键
- [ ] 前端 CodeInput 审查设置
- [ ] `integrations/github/{client,webhook}.ts`，`POST /api/webhooks/github`，worker 完成后回写 PR 评论
- 验收：相关单测通过；client 全量检查通过；基线通过

### 批次 8：文档收口（REQ-17）

- [ ] SECURITY.md、CONTRIBUTING.md、CHANGELOG.md
- [ ] README（新能力、配置、探针、导出、鉴权、Webhook、CI 徽章、LICENSE 提示）、`docs/optimization-log.md` 登记本轮
- 验收：全量 lint / typecheck / test / build 通过

## 进度台账

更新时间：2026-09-14 17:30

| 批次 | 状态 | 说明 |
| --- | --- | --- |
| 1 | 已完成，验收通过 | 首轮验收"不通过"仅因子目录 lint 脚本失效，已改为 `cd .. && eslint server/src` 并复核 |
| 2 | 已完成，验收通过 | 验收"有条件通过"提出的 4 项整改（fetch-url 上限、ConfigError 信息、探针兜底、closeDb 竞态）已全部修复 |
| 3 | 已完成，验收通过 | 验收"有条件通过"提出的 2 项重要整改（cancel / stream 用例、访问日志监听 close）已修复；pretty 日志改同步写 |
| 4 | 已完成，验收通过 | 验收"通过"附带的 3 项轻微建议（/assets/ 安全头补齐、解锁失败销毁连接、.dockerignore 保留旧规则）已修复 |
| 5 | 待开始 | 下次从这里继续：REQ-10 提示注入防御、REQ-11 ReAct 治理 |
| 6 | 待开始 | |
| 7 | 待开始 | |
| 8 | 待开始 | |

### 暂停时的状态（2026-09-14）

- 已完成批次 1 到 4，对应 REQ-01 到 REQ-09，四个批次均验收通过且整改项已关闭；server 单测 21 文件 / 161 用例，lint、typecheck、format、build 全部通过。
- 下次直接进入批次 5（REQ-10、REQ-11），实施前先通读 PRD 第 4 章全局约束与批次 5 任务项。
- 尚未处理的轻微建议：tasks.ts 处理器内直接 `res.json` 的 502 / 500 响应体不含 requestId；`createTaskBodySchema()` 每请求重建 schema（可按 maxCodeChars 缓存）；`vue/multi-word-component-names` 规则关闭需在 CHANGELOG 说明（批次 8）。
- 本机验证限制：Docker 守护进程未运行，Dockerfile 只做了静态检查，镜像构建交由 CI 的 docker job 验证。
- 工作方式：产品经理与验收由子智能体承担，开发由主智能体直接实施（子智能体开发效率不稳定）；每批次验收意见回流修复后再进入下一批。
