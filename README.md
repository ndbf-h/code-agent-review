# CodeAgentReview

Multi-Agent Code Review Platform — TypeScript full-stack with hand-written Agent engine.

## Stack

- **Frontend**: Vue 3 + Element Plus + Pinia + Axios
- **Backend**: Express 4 + sql.js (SQLite)
- **Agent Engine**: Hand-written ReAct loop + Tool Calling
- **LLM**: Claude API / OpenAI API (configurable)

## Quick Start

```bash
npm install
npm run install:all

cp .env.example .env
# Edit .env with your LLM API key

npm run dev
```

Frontend: http://localhost:5173
Backend: http://localhost:3001

## Project Structure

```
├── client/src/
│   ├── components/    ChatView, CodeInput, ChatMessage, ReviewReport
│   ├── composables/   useSSE.ts, useChat.ts
│   ├── stores/        review.ts (Pinia)
│   └── types/         Frontend type definitions
├── server/src/
│   ├── agent/         Agent engine (core)
│   │   ├── roles/     5 agent role system prompts
│   │   ├── react-loop.ts
│   │   ├── orchestrator.ts
│   │   ├── llm-client.ts
│   │   └── tool-registry.ts
│   ├── tools/         Mock tool implementations (7 tools)
│   ├── db/            SQLite schema + queries
│   ├── routes/        Express routes + SSE
│   └── services/      Business logic
└── shared/            Shared TypeScript types
```
