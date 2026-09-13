# 优化实施日志

> 每完成一项优化在此登记：做了什么、关键决策、量化结果。配合 `docs/optimization-plan-2026.md` 使用。

## 📍 当前进度索引（2026-08-16 会话结束时的状态）

| 项 | 状态 | 关键数字 |
| --- | --- | --- |
| P0-1 评测体系 | ✅ 完成 | 审查召回 81.5%；RAG baseline 75% |
| P0-2 可观测性 | ✅ 完成 | task_metrics 落库 + `/api/metrics` 聚合 + Langfuse 全链路 trace 树（4 span + 19 generation/任务，token 精确入库） |
| P1-3 混合 RAG | ✅ 完成（含向量分支） | **Recall@5 75%→100%，MRR 0.729→0.927，中文查询 0%→100%**（报告 `evals/reports/2026-08-16-rag-p1-vector.md`） |
| UI 重设计 | ✅ 完成 | 侧边栏 + 三区工作台（过程/结果/详情），浏览器实测全流程 |
| P1-4 MCP 双向接入 | ✅ 完成 | `/mcp` 暴露 11 工具（annotations 分级）；Client 自指挂载 11 个 `mcp_server_*` 工具 |
| P1-5 模型路由/语义缓存 | ✅ 完成 | 同代码二次提交 **32s/2.8万token → 6s/0 token**（cache_hit 实证）；路由实证 trace 内 **{reasoner: 4, chat: 14}**；85 测试全绿 |

**环境状态**：全部容器运行中（主栈 5 个 + observability profile 6 个，Langfuse UI http://localhost:3000）。
**密钥**（已写入根 `.env` 与 `server/.env`）：Langfuse pk/sk（BASE_URL 容器内用 `http://langfuse-server:3000`，本机用 localhost）、SiliconFlow 嵌入+重排（BGE-M3 / bge-reranker-v2-m3）、MCP_CLIENT_SERVERS 自指（容器内 `http://server:3001/mcp`）、ROLE_MODELS=logic=deepseek-reasoner（路由演示配置）。

**下次继续清单**：
1. M3 按余量选做：P2-6 安全防护（injection 检测+redteam）> P2-7 Agent 治理（循环熔断/token 预算）> P2-9 CI/CD（eval 门禁）；
2. 顺手项：judge 分歧样本 11 个人工复核；logic 维度 63.2% 短板 prompt 实验；ROLE_MODELS 当前是演示配置（reasoner 较贵），生产可改回或只给 security 配强模型；
3. 简历数字就绪：审查召回 81.5%、RAG 75%→100%（中文 0%→100%）、MRR 0.73→0.93、MCP 双向 + 11 工具、**重复请求零 token（缓存命中 13ms）**、按角色路由实证。

---

## 2026-08-16 · P1-5 模型路由 + 语义缓存 ✅

**做了什么**
- **角色路由**（`agent/role-router.ts`）：`ROLE_MODELS=role=model` 或 `role=alias:model`（跨 provider 需 `LLM_ROUTE_<别名>_BASE_URL/_API_KEY`）；`getClientForRole(role)` 带缓存的多实例路由，react-loop 加可选 `client` 参数、orchestrator 的 ReAct 与结构化输出都走角色 client；未配置角色的行为与之前完全一致（全局单例）。
- **语义缓存**（`review_cache` 表）：键 = sha256(代码|语言|模型|prompt版本)，prompt 大改时 bump `PROMPT_VERSION` 常量自然失效。consumer 在抢占后查缓存——命中直接落报告 + `report_ready/task_completed` 事件 + `task_metrics(cache_hit=true, tokens=0)`，零 LLM 成本秒级完成；成功结果写缓存。`/api/metrics` 增加 `tasks.last24h.cacheHits` 与 `reviewCache {entries, totalHits}`。
- 单测 5 个（ROLE_MODELS 解析/跨 provider 展开/非法条目容错），全套 85 个测试通过。

**端到端验证（全部实测）**
- **缓存**：同代码两次提交 → 第一次 32s/28089 tokens，第二次 **6s（执行仅 13ms）/0 tokens/cache_hit=true**；
- **路由**：`ROLE_MODELS=logic=deepseek-reasoner` 后，Langfuse trace 内 generation 模型分布 **{deepseek-reasoner: 4, deepseek-chat: 14}**——logic 角色的 4 次调用真实路由到 reasoner，其余角色不受影响。

**踩坑实录**
1. **v3 ingestion 不接受 `trace-update` 类型**（"No matching discriminator"）——同 id `trace-create` 附 `endTime` 即为更新；`span-update` 合法。
2. **Redis AUTH 不匹配导致 Langfuse 管道间歇断流**：server/worker 带密码连无密码 Redis → 给 Redis 加 `--requirepass` 并全局对齐 `REDIS_AUTH`。
3. **宿主机代理（Clash TUN）会拦截 Git Bash 的 localhost curl**——`http_proxy` 环境变量使 localhost 请求进代理失败，验证脚本需 `curl --noproxy '*'`。
4. **缓存命中不产生 trace 是正确行为**（没跑 LLM），排查时差点误判为上报管道故障——先查 `task_metrics.cache_hit` 再怀疑管道。
5. 一次任务 4 个 reviewer 全部规则降级（"unexpected end of hex escape"）为上游瞬时请求体损坏，与代理环境相关、重试即恢复；规则降级链兜住了故障，任务仍完成——降级设计的价值实证。

**面试锚点**：语义缓存的失效键设计（代码+模型+prompt 版本三元组）、按角色路由的成本/质量权衡、缓存命中在可观测性里的正确呈现（tokens=0 + cache_hit 标记而非"看不见"）。

## 2026-08-16 · P1-4 MCP 双向接入 ✅

**做了什么**
- **MCP Server**（`server/src/mcp/server.ts`）：11 个审查工具经 Streamable HTTP 暴露在 `/mcp`（无状态模式，每请求一个 transport）。用 SDK 底层 `Server` + `setRequestHandler` 直接返回原生 JSON Schema（绕开 zod registerTool 路径）；`tools/call` 直调 `tool.execute`（绕开 registry 的 5s 硬超时，另加 120s 上限）；annotations 安全分级——10 个只读工具 `readOnlyHint: true`，`applyFixes`（LLM 调用）标 false。挂载点在 `cors()` 之后、`express.json()` **之前**（MCP 自管 body，避开全局 parser 预读冲突）。
- **MCP Client**（`server/src/mcp/client.ts`）：`MCP_CLIENT_SERVERS`（alias=url，逗号分隔）配置外部 server，启动时 `listTools` 拉取远端工具、以 `mcp_<别名>_<工具名>` 注册进 toolRegistry（下划线命名兼容 OpenAI tool name 约束）；远端 JSON Schema 反向转换为项目 parameters 约定结构；连接失败仅告警不阻塞启动。server/worker 两进程均可挂载，orchestrator ReAct 循环零改动。
- 单测 9 个（schema 转换/required 标注表/安全分级/列表解析），全套 80 个测试通过。

**端到端验证（curl JSON-RPC + 自指）**
- `initialize` → `tools/list`（11 工具 + annotations 正确）→ `tools/call`（checkComplexity 实测圈复杂度=3）→ 未知工具返回 `isError: true`；
- **自指验证**：worker 配置 `MCP_CLIENT_SERVERS=http://server:3001/mcp` 指向自身，成功挂载 11 个 `mcp_server_*` 工具——协议双向打通的端到端证明。

**踩坑实录**
1. MCP 端点必须挂在全局 `express.json()` 之前，否则 parser 预读 body 导致 transport 拿不到原始请求；
2. 容器网络里自指地址是服务名 `http://server:3001/mcp`，不是 localhost（worker 的 localhost 是它自己）；
3. `docker compose up -d` 对 env_file 内容变更不触发重建，改 .env 后需 `--force-recreate`；更隐蔽的是**构建失败后只重建了 server 镜像、worker 还跑旧代码**——`up -d` 不会补建失败的服务镜像。

**面试锚点**：MCP 与 Function Call 的本质区别（互操作协议 vs 模型能力）、Streamable HTTP 传输与会话模式、annotations 作为客户端安全信号、SDK 底层 Server 类绕开 zod 的取舍。

## 2026-08-16 · UI 重设计：审查工作台三区布局 ✅

**做了什么**
- **App 级左侧边栏**（App.vue 重写）：图标+文字导航（审查/历史）+ 底部主题切换；去掉全局 `max-width: 1100px` 居中限制，主内容区全宽流式；≤900px 侧栏转为顶部横条。
- **ChatView 重构为三区工作台**（对标 GitHub/CodeRabbit/Langfuse）：
  - 左栏 `ProcessPanel`（新组件，264px 可折叠）：Agent 进度卡 + 事件时间线；**运行时展开、完成后自动收起**（结果优先），状态栏"过程"按钮随时回看；
  - 中栏：状态徽章条（排队/审查中/已完成/失败，带脉冲动画）→ 报告就绪即切换为结果视图（运行中为事件流）→ 底部固定输入区；
  - 右栏 `ContextPanel`（新组件，344px，三个 tab）：问题详情（severity/维度/行号徽章 + 完整描述 + 绿色修复建议框）、AI 助手（AssistantChat 整体移入，不再插在消息流里）、指标（MetricsPanel 移入）。
- **ReviewReport 改造**（SonarQube"图表即筛选器"模式）：评分环 + **严重度图块（9 高危/7 警告/5 建议）点击即筛选** + 维度 chips（分数+问题数，点击筛选）+ 问题列表行点击 → 右栏详情（行高亮联动）；内联展开交互移除。
- **ReportView/HistoryView** 放开 980px 限宽至 1400px。
- **响应式**：≤1280px 右栏转覆盖抽屉，≤900px 单列堆叠；明暗主题沿用 CSS 变量体系自动适配。

**关键决策**
- 不引入新依赖、不推翻组件体系：AssistantChat/MetricsPanel/AgentProgressPanel 原样复用仅重新布局；
- 过程与结果分离而非 Tab 切换：运行中用户要盯过程，完成后要读结果——自动切换 + 手动回看比 Tab 更符合两个阶段的注意力模型。

**验证**：浏览器实测 1600×900 全流程（提交 → 运行态三区 → 完成自动收起过程 → 图块筛选 → 点击问题联动右栏详情），vue-tsc 构建通过，7 个前端测试通过。

## 2026-08-16 · P0-1 评测体系 ✅

**做了什么**
- `server/src/eval/` 评测模块：RAG 检索评测（零 LLM 成本）、审查质量评测（直调 runReviewTask，假 taskId 天然不落生产表）、LLM-as-Judge（rubric 锚定 + 独立模型可配）、rematch 复算（匹配器校准后从 JSON 重算，零成本）。
- 数据集：48 个审查样本（easy 20 / tricky 16 / adversarial 12，对抗层内嵌中英文 prompt injection）+ 24 条五类 RAG 查询。
- `LlmClient` 支持 `constructor(overrides)` 独立模型实例（为 P1-5 模型路由铺路）。`npm run eval` CLI + README 评测章节。

**关键决策**
- 评测直调编排器不经队列，避免污染任务历史与 RabbitMQ；
- 匹配器首版全等口径过严（"SQL注入"无空格、"path traversal"英文报法被误判漏检），加入归一化 + 16 组同义词 + 跨维度兜底，rematch 复算零成本校准。

**量化结果（deepseek-chat，48 样本全量，163 万 token）**
- 审查召回率 53.7% → **81.5%**（校准后真实值）；分维度 security 90.5% / performance 87.5% / style 100% / **logic 63.2%（真实短板：竞态、缺 await、吞异常）**
- 降级率 0%、疑似注入服从 0
- RAG：Recall@5 **75.0%**、MRR 0.729、**中文查询 0% 召回**（词元打分丢弃 CJK，P1-3 靶子）
- Judge：coverage 7.4 / precision 6.3 / actionability 6.9

**遗留**：judge 分歧样本 11 个待人工复核；logic 维度短板待 prompt/工具改进后复测。

## 2026-08-16 · P0-2 可观测性 ✅

**做了什么**
- **指标落库**：新表 `task_metrics`（每次任务执行一行：status/model/token 用量/降级 reviewer 数/耗时/错误）；worker 结束时写入；`/api/metrics` 新增 `tasks.last24h/last7d`（成功率、token、P99 延迟）与 `recentFailures`，旧字段保留兼容前端面板。**修复了 MQ 改造后 metrics 只反映 API 进程的回归**。
- **全链路追踪**：`observability/tracing.ts` 用 AsyncLocalStorage 贯穿 consumer → runReviewTask → reviewer（`withReviewerSpan`）→ llm-client（`recordLlmUsage`），Langfuse 启用时挂 task/reviewer span + generation 事件（usage/模型），未配置密钥时退化为纯计数——**单任务 token 记账不依赖 Langfuse**（此前模块级全局计数器在并发任务下无法分摊）。
- **Langfuse 自托管栈**：compose 增加 `observability` profile（langfuse v3 + clickhouse/redis/minio/独立 PG），默认不启动，`docker compose --profile observability up -d` 按需拉起；密钥走 `LANGFUSE_*` 环境变量。

**关键决策**
- ALS 而非改函数签名：orchestrator/llm-client 零侵入，`Promise.allSettled` 并行的 reviewer 各自 fork 上下文不串扰；
- prompt 明文不入 trace（v1 有意为之，先保证用量与链路可见）；
- 指标与追踪解耦：Langfuse 是可选增强，`task_metrics` + `/api/metrics` 是永远可用的底座。

**验证结果**
- 60 测试全绿、tsc/build 通过；真实任务跑通：`task_metrics` 记录 26576+6468 tokens、27.8s、fallback 0；
- `/api/metrics` 返回 24h 聚合（runs=1、successRate=100%、p99=27826ms）。

**遗留**：trace 中暂未含 prompt 预览与每轮 ReAct span（后续按需加）。

## 2026-08-16 · P0-2 补充：Langfuse 栈启动验证 ✅

- Docker Hub 直连故障（DNS 污染），改用 DaoCloud 镜像源拉齐 clickhouse/langfuse 镜像并 retag；
- 三处配置修正后栈健康启动：`CLICKHOUSE_MIGRATION_URL` 须用 clickhouse 原生协议（`clickhouse://host:9000`）、S3 变量为 v3 的 `LANGFUSE_S3_EVENT_UPLOAD_*` 命名、去掉自定义 command 让镜像默认启动；
- UI 与健康端点均 200（http://localhost:3000）。**剩余一步为人工操作**：浏览器建组织/项目 → 生成 pk-/sk- 密钥 → 填 `.env` → 重启 server/worker，trace 即开始上报。

## 2026-08-16 · P0-2 追记：Langfuse 全链路打通 ✅（含 v3 自托管踩坑实录）

**最终状态**：单任务 trace = task + 4 reviewer span + 19 generation，延迟与 token 入库；UI http://localhost:3000。

**踩坑实录**（对后续维护极重要，全部写入 compose/代码注释）：
1. **v3 SDK 的遗留 API 已死**：`langfuse@3.38` 运行时类上没有可用的 trace/span/generation 方法（旧命令式路径不落地数据）。**解法**：弃用 SDK（已 npm uninstall），自研 `LangfuseIngestClient` 直写官方 HTTP Ingestion API（批量缓冲：3s 或 50 条触发，shutdown 强制 flush，200 响应内单条失败也检测）。
2. **Ingestion 契约**：`POST /api/public/ingestion`，信封为 `{"batch":[事件]}`；`generation-create` **必须带 `body.id`**；观测需 `level: "DEFAULT"`；generation 挂父节点用 `parentObservationId`（不是 spanId）；usage 为 `{input, output, total, unit: "TOKENS"}`（v2 的 promptTokens 命名不生效）。
3. **MinIO 桶不自动建**：Langfuse 事件上传依赖 `langfuse` 桶存在 → compose 增加 `langfuse-minio-init` 一次性服务（mc mb）。
4. **v3 是异步架构**：web 只收事件入队（Redis/S3），**必须部署 `langfuse-worker` 服务**写入 ClickHouse——缺它 trace 永远不出现。已补（镜像 langfuse/langfuse-worker:3，与 web 同套 env 去掉 NEXTAUTH）。
5. `CLICKHOUSE_MIGRATION_URL` 须用 clickhouse 原生协议 `clickhouse://host:9000`；S3 变量是 `LANGFUSE_S3_EVENT_UPLOAD_*` 命名。
6. Docker Hub 直连 DNS 污染 → DaoCloud 镜像源（docker.m.daocloud.io）拉取后 retag 一劳永逸。

## 2026-08-16 · P1-3 混合 RAG：管线实现 ✅

**做了什么**
- `tools/rag/` 新增混合检索管线：`tokenizer.ts`（CJK 二元组分词，修复 baseline 丢弃中文字符的缺陷）→ `bm25.ts`（BM25 词元分支）→ `providers.ts`（OpenAI 兼容 /embeddings 嵌入客户端 + /rerank 重排客户端，均带缓存、均可选）→ `hybrid-retriever.ts`（双分支 → **RRF 融合(k=60)** → 可选重排 → topK）；两分支皆无信号时保持零结果语义。
- `retrieveCodingGuidelines` 工具默认走 hybrid（`RAG_MODE=legacy` 可切回）；词元打分实现原样保留为 baseline 供评测对比。
- `evalRag` 升级为**双管线对比**：同一 24 条数据集同时跑 baseline 与 hybrid，报告含总体/分类型 before/after 与提升幅度。

**关键决策**
- 向量/重排服务做成 provider 可配置（SiliconFlow BGE-M3/bge-reranker），未配密钥自动降级为 BM25 单分支，系统照常运行；
- 语料为内存级小集合（8 种子 + 自定义文档），向量检索在进程内完成，**暂不引入 pgvector**（数十条文档上属过度设计；语料增长后迁移路径已在方案文档保留）；
- **种子知识库是英文的，中文查询的跨语言召回只能靠多语言嵌入分支**——这是当前数据结论的核心。

**中间数据（BM25 单分支，未配嵌入密钥）**
- Recall@5 75.0% → 75.0%（无回归），chinese-only 0%→0%（预期，需向量分支桥接中英语义）。

**测试**：新增 14 个 RAG 单测（分词/BM25/RRF/混合语义），全套 71 个测试通过。

## 2026-08-16 · P1-3 追记：向量分支开启后的最终数字 ✅

配置 SiliconFlow BGE-M3（嵌入）+ BGE-reranker-v2-m3（重排）后重跑双管线评测（报告 `evals/reports/2026-08-16-rag-p1-vector.md`）：

| 指标 | baseline | hybrid（BM25+向量+RRF+重排） |
| --- | --- | --- |
| **Recall@5** | 75.0% | **100.0%** |
| MRR | 0.729 | **0.927** |
| chinese-only | 0% | **100%** |
| code-snippet | 75% | **100%** |

**简历句式（真实数据）**："混合检索（BM25+多语言向量+RRF+重排）使 Recall@5 从 75% 提升至 100%，中文查询召回从 0% 提升至 100%，MRR 0.73→0.93"。

