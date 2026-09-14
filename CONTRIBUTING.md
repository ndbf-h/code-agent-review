# 贡献规范

本文件定义本仓库的**分支模型、命名规则、提交信息格式与合并流程**。每次拉取代码后请先读一遍，保证不同设备、不同环境下的操作方式一致。

## 一、分支模型

| 分支 | 用途 | 生命周期 |
| --- | --- | --- |
| `master` | 生产主线，任何时刻都应可构建、可测试、可部署 | 常驻 |
| `develop` | 集成线，日常开发汇总在这里（两台设备共用同一条） | 常驻 |
| `feat/<描述>` | 新功能 | 合并后删除 |
| `fix/<描述>` | 缺陷修复 | 合并后删除 |
| `docs/<描述>` | 文档 | 合并后删除 |
| `refactor/<描述>` | 重构（不改变外部行为） | 合并后删除 |
| `chore/<描述>` | 构建、依赖、配置 | 合并后删除 |
| `test/<描述>` | 测试补充与调整 | 合并后删除 |
| `ci/<描述>` | CI / CD 流水线 | 合并后删除 |
| `perf/<描述>` | 性能优化 | 合并后删除 |
| `release/v<版本>` | 发布准备，例如 `release/v1.2.0` | 发布完成即删 |
| `hotfix/v<版本>` | 线上紧急修复，从 `master` 拉出 | 合并完成即删 |

### 为什么不设「设备分支」

设备差异用 `git config user.name` / `user.email` 区分即可，分支名只表达**代码的成熟度和用途**。本地电脑与外出设备都直接使用 `develop`：一台 push 之后，另一台 `git pull --rebase origin develop` 同步，不需要按机器拆分支。按设备命名会自造语义（例如把共享集成分支 `develop` 当设备分支用），其他人看到会误判。

### 命名规则

- 全小写，单词之间用 `-` 连接；不使用空格、下划线、大写字母和中文
- 必须以表中前缀开头，前缀后必须跟有意义的描述
- 描述控制在 3~5 个单词，例如 `feat/rag-hybrid-retrieval`、`fix/sse-reconnect-state`
- 版本号只出现在 `release/`、`hotfix/`，格式为 `v主.次.修订`
- 禁止使用 `trial/`、`temp/`、`tmp/`、`test`、`new`、`bak`，以及 `work/xxx`、`dev/xxx` 这类按设备或位置自造语义的名字

## 二、提交信息规范

采用 Conventional Commits：

```text
<type>(<scope>): <中文简述>
```

- `type`：`feat` / `fix` / `docs` / `refactor` / `chore` / `test` / `ci` / `perf`
- `scope`：可选，模块名，例如 `server`、`client`、`queue`、`rag`
- 简述使用中文祈使句，不超过 50 字，结尾不加句号
- 一次提交只做一件事；禁止 `update`、`fix bug`、`修改`、`提交代码` 这类无信息量的标题

示例：

```text
feat(server): 增加任务级指标聚合接口
fix(client): 修复 SSE 断线重连后状态回退
docs: 新增分支与提交规范
chore(deps): 升级 vite 到 8.3.0
```

## 三、工作流程

### 1. 开始工作前先对齐集成线

```bash
git checkout develop
git fetch origin
git pull --rebase origin develop     # 有未完成改动时先 commit 或 stash
```

### 2. 提交

- 小而完整的改动，可以直接提交在 `develop` 上并推送
- 影响面较大、需要评审的改动，从 `develop` 另开 `feat/`、`fix/` 等短分支，完成后合并回 `develop`
- 提交前跑通「五、提交前验证清单」

### 3. 短分支合并回集成线

```bash
git checkout develop
git merge --no-ff feat/xxx
git branch -d feat/xxx
git push origin develop
```

### 4. 发布到主线

```bash
git checkout master
git pull --ff-only origin master
git merge --no-ff develop
git tag -a v1.2.0 -m "release v1.2.0"     # 有版本号之后
git push origin master --follow-tags
```

需要流水线验证时，推送分支后在 GitHub 开 PR，让 CI 跑完再合并。

### 5. 两台设备之间同步

```bash
# 设备 A push 之后，设备 B 只需：
git checkout develop
git pull --rebase origin develop
```

## 四、硬性约束

1. `master` 只接受已经通过验证的代码，不允许把未验证的提交直接推上去
2. 短分支之间**永不互相合并**，只允许与 `develop` 或 `master` 交互
3. 禁止对 `master`、`develop` 使用 `git push --force`
4. 短分支合并后立即删除；`release/*`、`hotfix/*` 用完即删
5. 分支必须按第一节的命名规范创建，临时分支不允许长期保留

## 五、提交前验证清单

```bash
npm run lint          # ESLint：0 error
npm run format:check  # Prettier 格式检查
npm run typecheck     # server + client 类型检查
npm test              # server + client 单元测试
npm run build --prefix server
npm run build --prefix client      # 改动前端时必跑
```

CI（`.github/workflows/ci.yml`）在 `push master`、`push develop` 和 Pull Request 时自动执行 lint、typecheck、test、build、Prettier 检查与 Docker 镜像构建。

> 注意：`release/*`、`feat/*` 等短分支上的 push 不会触发 CI。需要流水线验证时，把分支推送后开 PR。

## 六、依赖升级

- 依赖升级由 Dependabot 每周自动开 PR，配置见 `.github/dependabot.yml`
- 合并前必须本地跑通第五节的验证清单；major 版本升级额外确认破坏性变更
- 不要手工编辑 `package-lock.json`，统一用 `npm install` 生成
- 升级相关的提交统一使用 `chore(deps):` 前缀

## 七、发布相关分支的启用条件

| 分支 | 何时创建 | 从哪拉出 | 合到哪里 |
| --- | --- | --- | --- |
| `release/v<版本>` | 准备发版时 | `develop` | 合回 `master` 和 `develop`，然后删除 |
| `hotfix/v<版本>` | 线上出现紧急缺陷时 | `master` | 合回 `master` 和 `develop`，然后删除 |

`release/*` 上只允许版本号、文档和缺陷修复，不引入新功能。项目目前还没有正式版本号与发布节奏，这一层等第一次发版时再启用即可。
