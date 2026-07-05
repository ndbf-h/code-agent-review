# CodeAgentReview

多 Agent 代码审查平台 —— TypeScript 全栈，手写 Agent 引擎。

## 技术栈

- **前端**：Vue 3 + Element Plus + Pinia + Axios
- **后端**：Express 4 + sql.js（SQLite）
- **Agent 引擎**：手写 ReAct 循环 + Tool Calling
- **大模型**：Claude API / OpenAI API（可配置）

## 快速启动

```bash
npm install
npm run install:all

cp .env.example .env
# 编辑 .env 填入你的 LLM API Key

npm run dev
```

前端地址：http://localhost:5173
后端地址：http://localhost:3001

## 日志系统

使用内置结构化日志模块 `server/src/logger.ts`，支持四个日志等级：

| 等级 | 说明 |
|------|------|
| DEBUG | 调试信息，如 LLM 请求详情 |
| INFO | 一般信息，如任务开始/完成、LLM 响应成功 |
| WARN | 警告，如 LLM 返回空 choices |
| ERROR | 错误，如 LLM 请求失败 |

通过环境变量 `LOG_LEVEL` 控制输出级别（默认 `DEBUG`），例如 `LOG_LEVEL=INFO` 将只输出 INFO 及以上级别。

## 测试

项目使用 Vitest 作为测试框架。

```bash
# 运行后端测试
cd server && npm test

# 运行前端测试
cd client && npm test

# 监听模式
npm run test:watch
```

- **后端**：Node 环境，测试 Agent 引擎核心模块（tool-registry、llm-client）
- **前端**：jsdom 环境，支持 Vue 组件测试（@vue/test-utils）

## 项目结构

```
├── client/src/
│   ├── components/    ChatView、CodeInput、ChatMessage、ReviewReport
│   ├── composables/   useSSE.ts、useChat.ts
│   ├── stores/        review.ts（Pinia 状态管理）
│   └── types/         前端类型定义
├── server/src/
│   ├── logger.ts      结构化日志系统（支持 LOG_LEVEL 环境变量）
│   ├── agent/         核心 Agent 引擎
│   │   ├── roles/     5 个 Agent 角色的系统提示词
│   │   ├── react-loop.ts       ReAct 推理循环
│   │   ├── orchestrator.ts     编排器
│   │   ├── llm-client.ts       LLM 调用封装
│   │   └── tool-registry.ts    工具注册表
│   ├── tools/         7 个 Mock 工具实现
│   ├── db/            SQLite 建表 + 查询
│   ├── routes/        Express 路由 + SSE 推送
│   └── services/      业务逻辑
└── shared/            前后端共享的 TypeScript 类型
```
