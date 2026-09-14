# 同类开源项目竞品分析（2026-09-14）

## 一、调研范围与方法

- 对象：AI 代码审查 / PR 审查 Agent 类开源项目 8 个，另参考 2 个商业产品的公开配置文档。
- 方法：逐个访问 GitHub 仓库 README 与官方文档，核实接入方式、可定制性、输出形态、安全治理与工程化实践；不采信二手文章。
- 访问链接：
  - https://github.com/qodo-ai/pr-agent
  - https://github.com/kodustech/kodus-ai
  - https://github.com/mattzcarey/shippie （原 code-review-gpt，已更名）
  - https://github.com/anc95/ChatGPT-CodeReview
  - https://github.com/freeedcom/ai-codereviewer
  - https://github.com/reviewdog/reviewdog
  - https://github.com/danger/danger-js
  - https://github.com/semgrep/semgrep
  - CodeRabbit 配置文档（`.coderabbit.yaml`）
  - GitHub Copilot code review 文档（`.github/copilot-instructions.md` 与路径级 instructions）

## 二、功能矩阵

| 项目 | 接入方式 | 可定制 | 输出形态 | 安全与治理 | 工程化 | 多模型 |
| --- | --- | --- | --- | --- | --- | --- |
| qodo-ai/pr-agent | GitHub App / Action / CLI / Webhook；GitHub、GitLab、Bitbucket、Azure DevOps | `.pr_agent.toml` 分层配置：extra_instructions、ignore.glob / regex、忽略 PR 标题 / 分支 / 作者 | PR 描述、审查总结、行内代码建议、`/ask` 问答 | 大 PR 压缩策略、token 与成本明细输出 | GitHub Actions CI、Docker 镜像、Langfuse / OpenTelemetry 可观测 | LiteLLM 接入多提供商，按工具选模型 |
| kodustech/kodus-ai | Webhook 驱动，GitHub / GitLab / Bitbucket / Azure；NestJS 单体仓库，API / Worker / Webhooks 分进程 | Kody Rules：自然语言规则按仓库 / 路径生效 | PR 评论、仪表盘 | token 用量看板、BYOK | Docker Compose 自托管、CI、迁移管理 | BYOK 多模型 |
| mattzcarey/shippie | GitHub Action；本地 staged diff 审查 | 输入 IGNORE 通配、CUSTOM_INSTRUCTIONS、MCP_SERVERS；读取 AGENTS.md / CLAUDE.md 注入项目上下文 | PR 评论 | 限制 diff 体量 | Action 发布、测试 | 多提供商 |
| anc95/ChatGPT-CodeReview | GitHub App（probot）+ Action | IGNORE_PATTERNS / INCLUDE_PATTERNS、MAX_PATCH_LENGTH、自定义 PROMPT、LANGUAGE | 行内评论 | 补丁长度上限 | 轻量 | OpenAI 兼容 |
| freeedcom/ai-codereviewer | GitHub Action | exclude 通配过滤 | diff 分块送 LLM 生成行内评论 | 无 | 最小化 | OpenAI |
| reviewdog/reviewdog | CI 内运行，任何 linter 输出 | RDFormat / SARIF / checkstyle 输入格式，filter-mode | PR 评论、Checks、注解 | fail-level 退出码作为 CI 门禁 | 成熟 CI、发布流程 | 不涉及 |
| danger/danger-js | CI 后置脚本 | Dangerfile 代码化团队约定 | message / warn / fail 评论 | 规则可拒绝合并 | 成熟 | 不涉及 |
| semgrep/semgrep | CLI / CI | 规则集 | SARIF、JSON | 规则式 SAST，含 MCP Server | 成熟 | 不涉及 |
| CodeRabbit（商业） | GitHub App | `.coderabbit.yaml`：path_filters、path_instructions、review profile、auto_review 过滤 | 总结、行内评论、commit status 门禁 | 与 ESLint / Semgrep / gitleaks 等工具集成 | 托管 | 托管 |
| GitHub Copilot code review（商业） | GitHub 内置 | `.github/copilot-instructions.md`、路径级 instructions | PR 评论 | Lite / Balanced 成本档位，预算耗尽即阻断 | 托管 | 托管 |

## 三、值得本项目借鉴的设计点

| 序号 | 设计点 | 来源 | 适配理由 | 难度 |
| --- | --- | --- | --- | --- |
| 1 | 请求级 / 仓库级自定义审查指令与维度开关 | pr-agent、CodeRabbit、shippie、Kodus | 现有四个 reviewer 固定全跑，加配置即可复用编排 | M |
| 2 | SARIF 输出接入 CI 与 code scanning | reviewdog、Semgrep | 报告已是结构化 issue 列表，映射成本低 | S |
| 3 | Markdown 总结回写 PR | pr-agent、Kodus | 为 Webhook 闭环提供输出载体 | S |
| 4 | Webhook 签名校验 + PR 文件拉取 | Kodus、ChatGPT-CodeReview | 与现有任务队列天然衔接，任务来源写入 source 字段 | L |
| 5 | token 预算耗尽即降级或阻断 | Copilot code review、pr-agent | tracing 已按任务累计 token，只缺决策点 | M |
| 6 | 大输入体量上限 | shippie、ChatGPT-CodeReview | 用 MAX_CODE_CHARS 统一约束粘贴、URL 与 Webhook 三个入口 | S |
| 7 | 不受信任输入隔离 | 商业产品通行做法 | 代码当前原样拼进 prompt，需定界与检测 | M |
| 8 | 配置文件驱动的忽略规则 | pr-agent、CodeRabbit | 本轮以请求级配置替代，仓库级配置留待 Webhook 场景 | M |
| 9 | 成本与 token 明细可见 | pr-agent、Kodus | task_metrics 已落库，补预算与治理信息展示即可 | S |
| 10 | 完整工程化基线（CI、lint、非 root 镜像、治理文档） | pr-agent、Kodus、reviewdog | 本项目全部缺失，是"生产级"叙事的前置条件 | M |

## 四、生产级代码审查产品必备项清单

- 接入：Webhook 签名校验、PR 文件拉取、结果回写；输入体量上限；任务来源可追溯。
- 可定制：自定义指令、维度开关、严重度阈值、忽略规则。
- 输出：结构化 JSON、Markdown 总结、SARIF；导出接口受鉴权保护。
- 安全治理：不受信任输入隔离与注入检测、密钥脱敏、工具只读分级、token 预算、循环熔断。
- 工程化：CI 门禁（lint、typecheck、test、build）、配置 schema 校验、结构化日志与请求 ID、liveness / readiness 探针、非 root 镜像、版本化迁移、SECURITY / CONTRIBUTING / CHANGELOG。
