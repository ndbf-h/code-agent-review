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

## 项目结构

```
├── client/src/
│   ├── components/    ChatView、CodeInput、ChatMessage、ReviewReport
│   ├── composables/   useSSE.ts、useChat.ts
│   ├── stores/        review.ts（Pinia 状态管理）
│   └── types/         前端类型定义
├── server/src/
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
