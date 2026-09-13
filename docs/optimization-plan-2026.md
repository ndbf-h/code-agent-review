# 生产级优化方案（求职导向，基于 2026 岗位调研）

> 依据：数百份大模型岗位 JD 统计（知乎/掘金两篇独立分析）、1135 条 Agent 框架岗位量化分析、
> 9 篇大厂面经深读（字节/腾讯/阿里/蚂蚁/美团真题）。核心结论：市场考察点已从"用过什么框架"
> 转移到"有没有数据闭环"——评测、可观测、成本、安全，以及 MCP 等新协议的实操。

## 一、现状盘点

### 已有资产（直接构成"生产级"叙事，无需重做）

| 资产 | 面试价值 |
| --- | --- |
| 自研 ReAct 多 Agent 编排 + 规则引擎降级 | "为什么手搓不用框架"标准答辩 + 可靠性叙事 |
| RabbitMQ 任务队列（prefetch 并发/TTL 重试/DLQ/幂等抢占/心跳回收） | 分布式与消息队列生产实践 |
| SSE 事件流 + PG 事件表回放 + Last-Event-ID 断线续传 | 牛客高频题"刷新页面恢复未完成流内容"的实测实现 |
| SSRF 防护的 URL 抓取、限流、优雅关闭 | 安全与工程化基础 |

### 空档（按 JD 出现频率对应）

| 空档 | JD 频率 | 现状 |
| --- | --- | --- |
| 评测体系 | 面试分水岭 | 完全没有 |
| 可观测性 | 高频 | 仅进程内计数器（MQ 改造后已失真） |
| RAG 全链路 | 85% | 词元重合度内存打分（`tools/rag/retriever.ts`），无向量/混合/重排 |
| MCP | 17-24% 且快速上升 | 无 |
| 模型路由/成本控制 | 常见 | 全角色单模型 |
| 安全防护（prompt injection） | OWASP LLM Top1 | 无 |
| CI/CD | 30% | 无 |
| 认证多用户 | 基础项 | 无 |

## 二、路线图总览

```
M1（P0，1~2 周）数据闭环：评测体系 + Langfuse 可观测
M2（P1，2~3 周）JD 关键词：混合 RAG → MCP 双向 → 模型路由与语义缓存
M3（P2，按余量）生产纵深：安全 → Agent 治理 → 记忆 → CI/CD/K8s → 认证
依赖：P0 评测必须先行——P1 的 RAG/路由优化都需要它出 before/after 数据
```

---

## P0-1 评测体系（最优先，性价比之王）

**对应考察点**："你怎么知道 RAG/Agent 有效？评测集多少条？baseline 是什么？"（字节一面"崩"点）

**选型**：promptfoo（Node 原生、CI 友好、评测+红队一体）为主，LLM-as-Judge 自研评分器为辅。

**实施步骤**：
1. 新建 `server/src/eval/`，评测集 `evals/datasets/`：
   - `code-review.golden.jsonl`：50~100 个代码样本 + 期望问题（由规则引擎 pattern 反向构造 + 人工校对），按 简单/长尾/对抗 三层分布（对抗层 = 代码内嵌 prompt injection）；
   - `rag.queries.jsonl`：guidelines 知识库的查询集 + 标注的相关文档 id，用于 Recall@K / MRR。
2. 实现三个评测器：
   - `evalRag.ts`：跑 `retrieveGuidelines`，输出 Recall@5 / MRR（当前词元打分实现自动成为 baseline）；
   - `evalReview.ts`：跑完整审查，按维度算问题命中率 / 误报率（golden issue 匹配）；
   - `evalJudge.ts`：LLM-as-Judge 给报告评分（judge prompt 显式做位置偏差/自我偏好控制，输出与 golden 双轨对照）。
3. `npm run eval` 输出 markdown 报告到 `evals/reports/`（日期命名，可对比）。
4. promptfoo 配置 `evals/promptfoo.yaml`：接入系统 prompt 变体对比 + redteam（见 P2-6）。

**验收指标**：✅ 已达成（2026-08-16 首次全量评测，deepseek-chat）——
- 评测集 48 样本三层分布（easy 20 / tricky 16 / adversarial 12）+ 24 条 RAG 查询；
- **审查基线**：期望问题召回率 **81.5%**（匹配器校准前 53.7%，27.8pp 为措辞口径伪漏检——rematch 复算机制不重花 token）、规则引擎降级率 0%、疑似注入服从 0；分维度 security 90.5% / performance 87.5% / style 100% / **logic 63.2%（真实弱项：竞态、缺 await、吞异常）**；
- **RAG 基线**：Recall@5 75.0%、MRR 0.729、**中文查询 0% 召回**（词元打分丢弃 CJK）；
- **Judge 基线**：coverage 7.4/10、precision 6.3/10、actionability 6.9/10；
- 全量成本：163 万 token / 48 样本 / 25 分钟串行。报告归档 `evals/reports/`。

**简历话术**："构建 48 样本三层评测集（含 prompt injection 对抗层），确定性匹配 + LLM-as-Judge 双轨评测，检索优化 Recall@5 从 75% → __%（P1 完成后回填），审查召回率 81.5%、logic 维度 63.2% 为已知短板并定位到竞态类问题"。

## P0-2 可观测性（Langfuse 全链路追踪 + 指标落库）

**对应考察点**："一天跑多少任务、失败率多少、单任务成本多少？"

**选型**：Langfuse 自托管（docker compose 服务，官方 TS SDK）。

**实施步骤**：
1. compose 增加 `langfuse`（+ 其依赖 clickhouse/redis/minio，或用 Langfuse Cloud 免部署）；env 加 `LANGFUSE_PUBLIC_KEY/SECRET_KEY`。
2. `server/src/observability/tracing.ts`：封装 span 创建；在关键位置埋点：
   - `queue/consumer.ts` runClaimedTask → task 级 span（attempt、耗时、结局）；
   - `agent/orchestrator.ts` → reviewer 子 span（角色、reviewStatus、score）；
   - `agent/react-loop`（ReAct 循环）→ 每轮 thought/tool span；
   - `agent/llm-client.ts` chat/chatStream → generation 级（model、prompt/completion token、成本、延迟）。
3. 指标落库修复（MQ 改造遗留）：新表 `task_metrics`（task_id、model、prompt_tokens、completion_tokens、cost_usd、latency_ms、status），worker 写入，`/api/metrics` 改为聚合查询——解决"API 进程看不到 worker 消耗"的问题。
4. `/api/metrics` 增加任务维度：成功率、失败原因分布（DLQ 联动）、P50/P99 延迟、日均成本。

**验收指标**：✅ 已达成（2026-08-16，详见 docs/optimization-log.md）——`task_metrics` 落库 + `/api/metrics` 24h/7d 聚合（成功率/token/P99/失败清单），修复 MQ 改造后指标只反映 API 进程的回归；ALS 全链路追踪（task→reviewer→generation）+ Langfuse 自托管 compose profile（可选启用，未配密钥自动降级纯计数）。待办：Langfuse UI 建项目生成密钥后启用上报。

## P1-3 RAG 升级：混合检索 + 重排（85% JD 关键词）

**对应考察点**："为什么混合检索？为什么还要 Rerank？切片多大？BM25 够了还要向量吗？"（字节二面）

**实施步骤**：
1. pgvector：`knowledge_chunks` 加 `embedding vector(1024)` 列（schema.ts 迁移），embedding 用 BGE-M3（SiliconFlow HTTP，国内可用）或 OpenAI text-embedding-3-small，落库时同步生成。
2. 检索管线（重写 `tools/rag/retriever.ts`，保留旧实现为 baseline 供评测对比）：
   - 向量召回：pgvector 余弦 top-20；
   - 关键词召回：PG `tsvector` 全文检索（title + content）top-20；
   - **RRF 融合**（k=60）取 top-10；
   - **重排**：BGE-Reranker-v2-m3（SiliconFlow API）重排取 top-4；
   - 保留现有 dimension/language 过滤逻辑。
3. 切片策略：guidelines 按条款边界切（`\n\n` + 编号规则），chunk 512 token / overlap 64，入库时记录 section 元数据（面试答"为什么"：规范文档是条款型语料，语义完整性优先）。
4. 用 P0-1 评测器出 before/after：Recall@5、MRR、P99 延迟。

**验收指标**：Recall@5 相对 baseline 提升 ≥15pp；P99 < 200ms；评测报告归档。

## P1-4 MCP 双向接入（增速最快的 JD 关键词，差异化亮点）

**对应考察点**："MCP 和 Function Call 的本质区别？给团队接 10 个外部工具你选什么？"

**实施步骤**：
1. **MCP Server（对外）**：`server/src/mcp/server.ts`，用 `@modelcontextprotocol/sdk`（TS 官方，Streamable HTTP 传输），把 `toolRegistry` 的 11 个工具（scanCode、analyzeComplexity、applyFixes 等）适配暴露；新增 compose 服务或复用 API 进程挂 `/mcp` 路由。**效果：Claude Code / Cursor 直接把本项目当审查工具用**——简历稀缺亮点。
2. **MCP Client（对内）**：`server/src/mcp/client.ts`，orchestrator 启动时连接外部 MCP server（如 filesystem、git），把远端工具动态注册进 toolRegistry（标注来源与权限），展示 sampling/roots 概念理解。
3. 工具描述按 MCP 规范补全 inputSchema（规范化现有 `parameters` 为 JSON Schema）。
4. 安全边界：外部 MCP 工具默认只读白名单（呼应 P2-6）。

**验收指标**：✅ 已达成（2026-08-16，详见 docs/optimization-log.md P1-4 段）——`/mcp` Streamable HTTP 端点暴露 11 工具（annotations 只读分级，applyFixes 标非只读）；MCP Client 经 `MCP_CLIENT_SERVERS` 挂载外部工具（自指验证 11 个 `mcp_server_*` 注册成功）；README 含 Claude Code 接入配置；80 测试全绿。

## P1-5 模型路由与成本控制

**对应考察点**："Token 消耗大怎么优化？混合路由为什么重要？"（字节四面）

**实施步骤**：
1. per-role 模型路由：config 增加 `ROLE_MODELS`（如 style/logic → deepseek-chat，security → 强模型），`llm-client` 支持多实例按 role 注入；SSE 事件与 Langfuse 记录每角色实际模型。
2. **语义缓存**：新表 `review_cache`（code_hash + language + model_versions → report），命中直接返回缓存报告并标记 `cache_hit`；失效策略：模型版本或 prompt 版本变更即失效。
3. provider 级 prompt caching（DeepSeek context caching 天然生效，量化对比即可）。
4. 成本数据进 P0-2 的 task_metrics，出"路由 + 缓存前后单任务成本对比"。

**验收指标**：✅ 已达成（2026-08-16，详见 docs/optimization-log.md P1-5 段）——per-role 路由（ROLE_MODELS，支持跨 provider alias）实证：trace 内 generation 分布 {reasoner: 4, chat: 14}；语义缓存（sha256 三元组键 + PROMPT_VERSION 失效）实证：同代码二次提交 32s/2.8万token → 6s/0 token；`/api/metrics` 暴露 cacheHits 与 reviewCache 统计；85 测试全绿。

## P2-6 安全防护（纵深防御）

1. 输入检测：被审查代码中的 prompt injection 检测器（规则层：可疑指令模式；LLM 层：分类器判定），命中后代码内容以"引用包裹 + 转义"注入 prompt；
2. 输出脱敏：报告不回显密钥明文（规则引擎已能检测，补脱敏处理）；
3. 工具权限：白名单分级（只读 / 写 / 危险），MCP 外部工具默认只读；
4. promptfoo redteam 进 CI（复用 P0 的 promptfoo 配置，对抗层样本持续扩充）。

## P2-7 Agent 治理（死循环/预算/人工干预）

1. 循环检测：ReAct 循环内记录 (tool, params-hash) 序列，连续重复 ≥2 次熔断该工具并提示模型换策略；
2. 单任务 token 预算：超限降级为规则引擎模式（复用现有 fallback 链）；
3. HITL：高危操作（如未来的 applyFixes 写文件）走审批端点，SSE 推 `approval_required` 事件。

## P2-8 长期记忆（朴素实现 + 选型答辩）

新表 `scope_memory`（scope_id、insight、source_task_id、created_at）：任务完成后用便宜模型把"重复出现的问题模式/团队偏好"沉淀为结构化记忆，检索时与 guidelines 一同注入。答辩口径：对比过 Mem0/Zep/Letta，选择 PG 朴素实现因为审查场景记忆量小、强一致、零外部依赖——"知道自己在用什么、没用什么"。

## P2-9 CI/CD 与 K8s

1. GitHub Actions：`ci.yml` = install → build → vitest → **eval gate（评测指标低于阈值阻止合并）**；
2. 可选 `deploy/k8s/`：server Deployment + worker Deployment（HPA 按 queue depth 或 CPU）+ rabbitmq/pg 依赖声明，展示"扩 worker 实例"的完整闭环。

## P2-10 认证与多用户

JWT 登录 + `tasks.user_id` 隔离 + 限流按用户维度（顺手修复"监控轮询吃掉创建配额"的读写配额不分问题）。

---

## 三、里程碑与工作量

| 里程碑 | 内容 | 工作量 | 简历新增量化点 |
| --- | --- | --- | --- |
| M1 | P0-1 + P0-2 | 1~2 周 | 评测集/双轨评测；全链路 trace；成功率与成本基线 |
| M2 | P1-3 → P1-4 → P1-5 | 2~3 周 | Recall@5 提升 Xpp；MCP 双向；成本降 X% |
| M3 | P2 按余量（安全 > 治理 > CI > 记忆 > 认证） | 各 2~5 天 | 红队拦截率；循环熔断；eval CI 门禁 |

## 四、答辩 FAQ（提前准备，不写代码但决定成败）

| 必考题 | 你的答案锚点 |
| --- | --- |
| 为什么手搓而不用 LangGraph？ | 定制审查流水线 + 理解机制；能对比 LangGraph（checkpoint/图状态机）、Mastra（TS 全家桶）、OpenAI Agents SDK 的边界；自研层与 MCP 协议解耦，可替换 |
| 和 Claude Code/Codex 区别？ | 通用 coding agent vs 垂直审查流水线（规则预扫 + 多维并行 + 结构化报告 + 评测基线 + MCP 可被它们调用） |
| 生产踩过什么坑？ | SSE 回放乱序竞态、token 事件风暴（合并落库）、双跑防护（心跳回收而非 redelivery 重跑）、监控轮询吃限流配额 |
| RAG 召回率低怎么排查？ | 按 P0/P1 建立的排查链：Top-K 有无答案 → 无则查切片/索引/召回，有靠后则查融合/重排，位置对仍错则查 prompt |
| MCP 和 Function Call 区别？ | FC 是模型能力（单应用内工具调用），MCP 是互操作协议（工具的发现/生命周期/跨应用复用）——做完 P1-4 有第一手细节 |

## 五、风险与取舍

- **语言生态**：Agent 岗 Python 占 91-96%，TS 项目主打"全栈 + AI 工程化"岗最匹配；若冲纯 Agent 后端岗，补一个 Python 评测 sidecar（DeepEval/RAGAS 进 CI）一举补齐语言短板。
- **不自研网关**：LiteLLM/Bifrost 自托管成本高，模型路由用轻量自实现（配置化 + llm-client 多实例），答辩时对比过网关方案即可。
- **不做 A2A**：协议年轻且对单产品价值有限，答辩知道"MCP 纵向 / A2A 横向"的区别即可。
- **不迁移框架**：自研编排是项目卖点；迁移 = 重写且丧失差异化。
