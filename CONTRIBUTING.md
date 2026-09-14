# 贡献规范

本文件定义本仓库的**分支模型、命名规则、提交信息格式与合并流程**。每次拉取代码后请先读一遍，保证不同设备上的操作方式一致。

## 一、分支模型

仓库只有一条主线，其余分支要么是设备工作分支，要么是短生命周期的特性分支。

| 分支 | 用途 | 生命周期 |
| --- | --- | --- |
| `master` | 唯一主线，任何时刻都应可构建、可测试、可部署 | 常驻 |
| `work/local-hzq` | 本地电脑设备的提交分支 | 常驻 |
| `work/remote-hzq` | 外出设备（远程环境）的提交分支 | 常驻 |
| `feat/<描述>` | 新功能 | 合并后删除 |
| `fix/<描述>` | Bug 修复 | 合并后删除 |
| `docs/<描述>` | 文档 | 合并后删除 |
| `refactor/<描述>` | 重构（不改变外部行为） | 合并后删除 |
| `chore/<描述>` | 构建、依赖、配置 | 合并后删除 |
| `test/<描述>` | 测试补充与调整 | 合并后删除 |
| `ci/<描述>` | CI / CD 流水线 | 合并后删除 |
| `perf/<描述>` | 性能优化 | 合并后删除 |

### 命名规则

- 全小写，单词之间用 `-` 连接；不使用空格、下划线、大写字母和中文
- 必须以表中前缀开头，前缀后必须跟有意义的描述
- 描述控制在 3~5 个单词，例如 `feat/rag-hybrid-retrieval`、`fix/sse-reconnect-state`
- 禁止使用 `trial/`、`temp/`、`tmp/`、`test`、`dev`、`new`、`bak` 这类无法表达意图的名字
- `work/` 前缀后的设备标识必须在文末「设备登记表」中登记，不要临时新增

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

### 1. 开始工作前先对齐主线

```bash
git checkout work/local-hzq        # 或 work/remote-hzq
git fetch origin
git rebase origin/master           # 有未完成改动时先 commit 或 stash
```

### 2. 提交

- 小而完整的改动，可以直接提交在自己的 `work/<设备>` 分支上
- 需要评审、影响面较大的改动，另开 `feat/`、`fix/` 等短分支，完成后合并
- 提交前跑通「五、提交前验证清单」

### 3. 合并进 master

```bash
git checkout master
git pull --ff-only origin master
git merge --no-ff work/local-hzq   # 或 feat/xxx，保留合并记录
git push origin master
```

也可以推送分支后在 GitHub 开 PR，让 CI 跑完再合并。

### 4. 合并后对齐另一台设备

```bash
git checkout work/remote-hzq
git rebase master                  # 确认没有未推送改动时，也可用 git reset --hard master
```

## 四、硬性约束

1. `master` 只接受已经通过验证的代码，不允许把未验证的提交直接推上去
2. 两条 `work/*` 分支之间**永不互相合并**，二者只与 `master` 交互
3. 禁止对 `master` 使用 `git push --force`
4. 特性分支合并进 `master` 后立即删除（`work/*` 设备分支除外）
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

CI（`.github/workflows/ci.yml`）会在 `push master` 和 Pull Request 时自动执行 lint、typecheck、test、build、Prettier 检查与 Docker 镜像构建。

> 注意：`work/*` 分支上的 push 不会触发 CI。需要流水线验证时，请把分支推送后开 PR。

## 六、依赖升级

- 依赖升级由 Dependabot 每周自动开 PR，配置见 `.github/dependabot.yml`
- 合并前必须本地跑通第五节的验证清单；major 版本升级额外确认破坏性变更
- 不要手工编辑 `package-lock.json`，统一用 `npm install` 生成
- 升级相关的提交统一使用 `chore(deps):` 前缀

## 七、设备登记表

| 设备标识 | 设备说明 | 对应分支 |
| --- | --- | --- |
| `local-hzq` | 本地电脑 | `work/local-hzq` |
| `remote-hzq` | 外出设备（远程环境） | `work/remote-hzq` |

新增设备时，先在此登记，再按 `work/<设备标识>` 的格式创建分支。
