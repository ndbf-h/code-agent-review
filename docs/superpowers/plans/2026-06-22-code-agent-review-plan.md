# CodeAgentReview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Multi-Agent code review platform where users submit code and 4 expert agents (Security, Performance, Style, Logic) review it in parallel with an Orchestrator coordinating the workflow.

**Architecture:** Vue 3 frontend (Vite + Element Plus + Pinia) talks to Express 4 backend via REST + SSE. Backend runs a hand-written Agent engine with ReAct loop, Tool Registry, and Mock tools. SQLite for persistence.

**Tech Stack:** Vue 3, Vite, Element Plus, Pinia, Axios, Express 4, better-sqlite3, TypeScript, Claude API / OpenAI API

## Global Constraints

- Language: TypeScript (strict mode) for both client and server
- Indentation: 2 spaces, no tabs
- Strings: single quotes, no semicolons
- Files/folders: kebab-case
- Components: PascalCase (.vue)
- Variables/functions: camelCase
- Agent engine: hand-written, no LangChain/LangGraph dependency
- Tools: all Mock implementations
- Max ReAct rounds: 5 per agent
- Max function lines: 30
- Error handling: try-catch with async/await

---

### Task 1: Project Scaffolding

**Files:**
- Create: `code-agent-review/package.json`
- Create: `code-agent-review/.gitignore`
- Create: `code-agent-review/server/package.json`
- Create: `code-agent-review/server/tsconfig.json`
- Create: `code-agent-review/client/package.json` (via Vite scaffolding)
- Create: `code-agent-review/shared/package.json`

**Produces:**
- `code-agent-review/` — monorepo root with working directory structure
- Git repo initialized at root

---

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p code-agent-review/server/src/{routes,services,agent/roles,tools,db}
mkdir -p code-agent-review/shared
cd code-agent-review
git init
```

- [ ] **Step 2: Write root package.json**

Create `code-agent-review/package.json`:

```json
{
  "name": "code-agent-review",
  "private": true,
  "scripts": {
    "dev": "concurrently \"npm run dev:server\" \"npm run dev:client\"",
    "dev:server": "cd server && npm run dev",
    "dev:client": "cd client && npm run dev",
    "install:all": "cd server && npm install && cd ../client && npm install"
  },
  "devDependencies": {
    "concurrently": "^8.2.2"
  }
}
```

- [ ] **Step 3: Write .gitignore**

Create `code-agent-review/.gitignore`:

```
node_modules/
dist/
*.db
.env
.env.local
```

- [ ] **Step 4: Write server package.json**

Create `code-agent-review/server/package.json`:

```json
{
  "name": "code-agent-review-server",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "express": "^4.21.0",
    "better-sqlite3": "^11.3.0",
    "cors": "^2.8.5",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/better-sqlite3": "^7.6.11",
    "@types/cors": "^2.8.17",
    "@types/uuid": "^10.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 5: Write server tsconfig.json**

Create `code-agent-review/server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 6: Write shared package.json**

Create `code-agent-review/shared/package.json`:

```json
{
  "name": "code-agent-review-shared",
  "private": true,
  "main": "./types.ts"
}
```

- [ ] **Step 7: Scaffold Vue 3 frontend**

```bash
cd code-agent-review/client
npm create vite@latest . -- --template vue-ts
```

Expected: Vite scaffolds `client/` with Vue 3 + TypeScript template.

- [ ] **Step 8: Install all dependencies**

```bash
cd code-agent-review
npm install
npm run install:all
```

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "chore: scaffold project structure"
```

---

### Task 2: Shared Types and Database Schema

**Files:**
- Create: `code-agent-review/shared/types.ts`
- Create: `code-agent-review/server/src/db/schema.ts`
- Create: `code-agent-review/server/src/db/connection.ts`

**Interfaces:**
- Produces:
  - `shared/types.ts`: `Task`, `Agent`, `Message`, `ToolCall`, `Report`, `TaskStatus`, `AgentRole`, `AgentStatus`, `MessageType`, `Severity`, `Issue` types
  - `server/src/db/connection.ts`: `getDb()` → `Database`
  - `server/src/db/schema.ts`: `initDb()` → `void`

---

- [ ] **Step 1: Write shared types**

Create `code-agent-review/shared/types.ts`:

```typescript
// Task statuses
type TaskStatus = 'pending' | 'orchestrating' | 'reviewing' | 'summarizing' | 'completed' | 'failed'

// Agent roles
type AgentRole = 'orchestrator' | 'security' | 'performance' | 'style' | 'logic'

// Agent statuses
type AgentStatus = 'idle' | 'thinking' | 'calling_tool' | 'done' | 'error'

// Message types
type MessageType = 'user_input' | 'agent_thought' | 'tool_call' | 'tool_result' | 'final_answer'

// Issue severity
type Severity = 'critical' | 'warning' | 'suggestion'

interface Issue {
  line: number
  severity: Severity
  category: string
  message: string
  suggestion: string
}

interface AgentResult {
  issues: Issue[]
  score: number
}

interface ReportContent {
  issues: Issue[]
  agentResults: Record<AgentRole, AgentResult>
}

interface Task {
  id: string
  title: string
  codeSnippet: string
  language: string
  status: TaskStatus
  createdAt: string
}

interface Agent {
  id: string
  taskId: string
  role: AgentRole
  status: AgentStatus
  modelName: string
  createdAt: string
}

interface Message {
  id: string
  taskId: string
  agentId: string | null
  role: 'user' | 'agent' | 'system'
  content: string
  type: MessageType
  createdAt: string
}

interface ToolCall {
  id: string
  agentId: string
  messageId: string
  toolName: string
  input: string
  output: string
  createdAt: string
}

interface Report {
  id: string
  taskId: string
  content: string
  score: number
  createdAt: string
}

export type {
  TaskStatus, AgentRole, AgentStatus, MessageType, Severity,
  Issue, AgentResult, ReportContent,
  Task, Agent, Message, ToolCall, Report
}
```

- [ ] **Step 2: Write database connection**

Create `code-agent-review/server/src/db/connection.ts`:

```typescript
import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.join(__dirname, '..', '..', 'data.db')

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
  }
  return db
}

export { getDb }
```

- [ ] **Step 3: Write database schema**

Create `code-agent-review/server/src/db/schema.ts`:

```typescript
import { getDb } from './connection'

function initDb(): void {
  const db = getDb()

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      code_snippet TEXT NOT NULL,
      language TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      model_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (message_id) REFERENCES messages(id)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      score INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
  `)
}

export { initDb }
```

- [ ] **Step 4: Commit**

```bash
git add shared/types.ts server/src/db/
git commit -m "feat: add shared types and database schema"
```

---

### Task 3: LLM Client

**Files:**
- Create: `code-agent-review/server/src/agent/types.ts`
- Create: `code-agent-review/server/src/agent/llm-client.ts`

**Interfaces:**
- Consumes: `shared/types.ts` — none directly
- Produces:
  - `agent/types.ts`: `LlmMessage`, `LlmResponse`, `ToolDefinition`, `ToolCallRequest`
  - `agent/llm-client.ts`: `LlmClient` class with `chat(messages, tools?)` → `Promise<LlmResponse>`

---

- [ ] **Step 1: Write Agent core types**

Create `code-agent-review/server/src/agent/types.ts`:

```typescript
interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  name?: string
}

interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

interface ToolCallRequest {
  id: string
  name: string
  input: Record<string, unknown>
}

interface LlmResponse {
  content: string
  finishReason: 'stop' | 'tool_use' | 'error'
  toolCalls: ToolCallRequest[]
}

export type { LlmMessage, ToolDefinition, ToolCallRequest, LlmResponse }
```

- [ ] **Step 2: Write LLM Client**

Create `code-agent-review/server/src/agent/llm-client.ts`:

```typescript
import type { LlmMessage, ToolDefinition, LlmResponse, ToolCallRequest } from './types'

const LLM_API_KEY = process.env.LLM_API_KEY || ''
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.anthropic.com'
const LLM_MODEL = process.env.LLM_MODEL || 'claude-sonnet-4-6'

class LlmClient {
  private apiKey: string
  private baseUrl: string
  private model: string

  constructor() {
    this.apiKey = LLM_API_KEY
    this.baseUrl = LLM_BASE_URL
    this.model = LLM_MODEL
  }

  async chat(messages: LlmMessage[], tools?: ToolDefinition[]): Promise<LlmResponse> {
    // 将工具定义转为 Anthropic API 格式
    const anthropicTools = tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object',
        properties: t.parameters,
        required: Object.keys(t.parameters)
      }
    }))

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 4096,
      messages: messages.filter(m => m.role !== 'system'),
      system: messages.find(m => m.role === 'system')?.content || '',
      tools: anthropicTools || []
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`LLM API error: ${response.status} ${errorText}`)
    }

    const data = await response.json() as Record<string, unknown>

    // 解析响应
    const content = data.content as Array<{ type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown> }>

    const textBlock = content.find(c => c.type === 'text')
    const toolBlocks = content.filter(c => c.type === 'tool_use')

    const toolCalls: ToolCallRequest[] = toolBlocks.map(t => ({
      id: t.id || '',
      name: t.name || '',
      input: t.input || {}
    }))

    const finishReason = toolCalls.length > 0 ? 'tool_use' : 'stop'

    return {
      content: textBlock?.text || '',
      finishReason,
      toolCalls
    }
  }
}

const llmClient = new LlmClient()

export { LlmClient, llmClient }
```

- [ ] **Step 3: Commit**

```bash
git add server/src/agent/types.ts server/src/agent/llm-client.ts
git commit -m "feat: add agent core types and LLM client"
```

---

### Task 4: Tool Registry and Memory

**Files:**
- Create: `code-agent-review/server/src/agent/tool-registry.ts`
- Create: `code-agent-review/server/src/agent/memory.ts`

**Interfaces:**
- Consumes:
  - `agent/types.ts`: `ToolDefinition`, `ToolCallRequest`
- Produces:
  - `tool-registry.ts`: `Tool` interface, `ToolRegistry` class (`register(tool)`, `get(name)`, `getDefinitions()`, `execute(name, input)`)
  - `memory.ts`: `Memory` class (`add(message)`, `getContext()` → `LlmMessage[]`)

---

- [ ] **Step 1: Write Tool Registry**

Create `code-agent-review/server/src/agent/tool-registry.ts`:

```typescript
import type { ToolDefinition, ToolCallRequest } from './types'

interface Tool {
  definition: ToolDefinition
  execute: (input: Record<string, unknown>) => Promise<string>
}

class ToolRegistry {
  private tools: Map<string, Tool> = new Map()

  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition)
  }

  async execute(call: ToolCallRequest): Promise<string> {
    const tool = this.tools.get(call.name)
    if (!tool) {
      throw new Error(`Tool not found: ${call.name}`)
    }
    return tool.execute(call.input)
  }
}

const toolRegistry = new ToolRegistry()

export { type Tool, ToolRegistry, toolRegistry }
```

- [ ] **Step 2: Write Memory (context window management)**

Create `code-agent-review/server/src/agent/memory.ts`:

```typescript
import type { LlmMessage } from './types'

const MAX_CONTEXT_CHARS = 20000  // ≈ 5000 tokens

class Memory {
  private messages: LlmMessage[] = []

  add(message: LlmMessage): void {
    this.messages.push(message)
  }

  getContext(): LlmMessage[] {
    // 如果总字符数超限，从头部裁剪旧消息
    let totalChars = 0
    const result: LlmMessage[] = []

    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msgChars = this.messages[i].content.length
      if (totalChars + msgChars > MAX_CONTEXT_CHARS) {
        break
      }
      result.unshift(this.messages[i])
      totalChars += msgChars
    }

    return result
  }

  clear(): void {
    this.messages = []
  }
}

export { Memory }
```

- [ ] **Step 3: Commit**

```bash
git add server/src/agent/tool-registry.ts server/src/agent/memory.ts
git commit -m "feat: add tool registry and memory management"
```

---

### Task 5: ReAct Loop

**Files:**
- Create: `code-agent-review/server/src/agent/react-loop.ts`

**Interfaces:**
- Consumes:
  - `agent/types.ts`: `LlmMessage`, `ToolDefinition`, `LlmResponse`
  - `agent/tool-registry.ts`: `toolRegistry`
  - `agent/memory.ts`: `Memory`
  - `agent/llm-client.ts`: `llmClient`
- Produces:
  - `react-loop.ts`: `runReActLoop(systemPrompt, tools, memory, onStep)` → `Promise<string>`

---

- [ ] **Step 1: Write ReAct Loop**

Create `code-agent-review/server/src/agent/react-loop.ts`:

```typescript
import { llmClient } from './llm-client'
import { toolRegistry } from './tool-registry'
import { Memory } from './memory'
import type { ToolDefinition } from './types'

const MAX_ROUNDS = 5

interface StepCallback {
  (type: 'thought', content: string): void
  (type: 'tool_call', toolName: string, input: Record<string, unknown>): void
  (type: 'tool_result', toolName: string, output: string): void
}

async function runReActLoop(
  systemPrompt: string,
  tools: ToolDefinition[],
  memory: Memory,
  onStep?: StepCallback
): Promise<string> {
  memory.add({ role: 'system', content: systemPrompt })

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const context = memory.getContext()
    const response = await llmClient.chat(context, tools)

    if (response.finishReason === 'stop') {
      memory.add({ role: 'assistant', content: response.content })
      onStep?.('thought', response.content)
      return response.content
    }

    if (response.finishReason === 'tool_use') {
      for (const toolCall of response.toolCalls) {
        onStep?.('tool_call', toolCall.name, toolCall.input)

        memory.add({
          role: 'assistant',
          content: JSON.stringify({ toolCall: toolCall.name, input: toolCall.input })
        })

        try {
          const result = await toolRegistry.execute(toolCall)
          onStep?.('tool_result', toolCall.name, result)

          memory.add({
            role: 'tool',
            content: result,
            toolCallId: toolCall.id,
            name: toolCall.name
          })
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          memory.add({
            role: 'tool',
            content: `Error: ${errorMsg}`,
            toolCallId: toolCall.id,
            name: toolCall.name
          })
        }
      }
    }
  }

  // 达到最大轮数，强制要求 LLM 给出最终答案
  memory.add({
    role: 'user',
    content: 'You have reached the maximum number of steps. Please provide your final answer now based on the information gathered.'
  })

  const context = memory.getContext()
  const finalResponse = await llmClient.chat(context, [])
  memory.add({ role: 'assistant', content: finalResponse.content })
  return finalResponse.content
}

export { runReActLoop }
export type { StepCallback }
```

- [ ] **Step 2: Commit**

```bash
git add server/src/agent/react-loop.ts
git commit -m "feat: add ReAct loop implementation"
```

---

### Task 6: Agent Role Definitions

**Files:**
- Create: `code-agent-review/server/src/agent/roles/orchestrator.ts`
- Create: `code-agent-review/server/src/agent/roles/security-reviewer.ts`
- Create: `code-agent-review/server/src/agent/roles/performance-reviewer.ts`
- Create: `code-agent-review/server/src/agent/roles/style-reviewer.ts`
- Create: `code-agent-review/server/src/agent/roles/logic-reviewer.ts`
- Create: `code-agent-review/server/src/agent/roles/index.ts`

**Interfaces:**
- Produces:
  - `roles/index.ts`: `getRoleDefinition(role: AgentRole)` → `{ systemPrompt: string, tools: ToolDefinition[] }`

---

- [ ] **Step 1: Write Orchestrator role**

Create `code-agent-review/server/src/agent/roles/orchestrator.ts`:

```typescript
const systemPrompt = `You are the Code Review Orchestrator. Your job is to coordinate a multi-agent code review process.

When you receive code, follow these steps:
1. Analyze the code and decompose the review into 4 dimensions: security, performance, style, logic
2. For each dimension, create a focused sub-task describing what to look for
3. Dispatch each sub-task to the appropriate specialist agent
4. Collect all findings from the agents
5. Generate a structured review report with an overall score (0-100)

Use the tools provided to decompose, assign, collect, and generate the report.
Always wait for all agents to finish before generating the final report.`

export { systemPrompt }
```

Create `code-agent-review/server/src/agent/roles/security-reviewer.ts`:

```typescript
const systemPrompt = `You are a Security Review Specialist. Your focus is identifying security vulnerabilities in code.

Look for:
- SQL injection: user input concatenated into queries
- XSS vulnerabilities: unescaped output
- Sensitive data exposure: hardcoded secrets, tokens, passwords
- Insecure dependencies or patterns
- Missing input validation
- Missing authentication/authorization checks

For each issue found, report: line number, severity (critical/warning/suggestion), category, description, and a concrete fix suggestion.

Use the tools provided to analyze the code. Be thorough and precise.`

export { systemPrompt }
```

Create `code-agent-review/server/src/agent/roles/performance-reviewer.ts`:

```typescript
const systemPrompt = `You are a Performance Review Specialist. Your focus is identifying performance issues in code.

Look for:
- N+1 query problems: queries inside loops
- Unnecessary re-renders or re-computations
- Missing memoization where appropriate
- Inefficient data structures or algorithms
- Unbounded loops or recursion without base cases
- Missing lazy loading or pagination
- Synchronous blocking operations that could be async

For each issue found, report: line number, severity (critical/warning/suggestion), category, description, and a concrete fix suggestion.

Use the tools provided to analyze the code. Be thorough and precise.`

export { systemPrompt }
```

Create `code-agent-review/server/src/agent/roles/style-reviewer.ts`:

```typescript
const systemPrompt = `You are a Code Style Review Specialist. Your focus is reviewing code quality and maintainability.

Look for:
- Non-descriptive variable or function names
- Missing or outdated comments
- Functions that are too long (over 30 lines)
- Deep nesting (over 3 levels)
- Missing error handling (try-catch)
- Inconsistent formatting or naming conventions
- Missing TypeScript type annotations
- Magic numbers without named constants

For each issue found, report: line number, severity (critical/warning/suggestion), category, description, and a concrete fix suggestion.

Use the tools provided to analyze the code. Be thorough and precise.`

export { systemPrompt }
```

Create `code-agent-review/server/src/agent/roles/logic-reviewer.ts`:

```typescript
const systemPrompt = `You are a Logic Review Specialist. Your focus is identifying logic errors and edge cases in code.

Look for:
- Missing null/undefined checks
- Boundary conditions: empty arrays, zero values, negative numbers
- Off-by-one errors in loops
- Incorrect boolean logic or condition ordering
- Missing return statements or unreachable code
- Type coercion issues (== vs ===)
- Race conditions in async code
- Unhandled promise rejections

For each issue found, report: line number, severity (critical/warning/suggestion), category, description, and a concrete fix suggestion.

Use the tools provided to analyze the code. Be thorough and precise.`

export { systemPrompt }
```

- [ ] **Step 2: Write roles index**

Create `code-agent-review/server/src/agent/roles/index.ts`:

```typescript
import type { AgentRole } from '../../../../shared/types'
import { systemPrompt as orchestrator } from './orchestrator'
import { systemPrompt as security } from './security-reviewer'
import { systemPrompt as performance } from './performance-reviewer'
import { systemPrompt as style } from './style-reviewer'
import { systemPrompt as logic } from './logic-reviewer'

const rolePrompts: Record<AgentRole, string> = {
  orchestrator,
  security,
  performance,
  style,
  logic
}

function getRolePrompt(role: AgentRole): string {
  return rolePrompts[role]
}

export { getRolePrompt }
```

- [ ] **Step 3: Commit**

```bash
git add server/src/agent/roles/
git commit -m "feat: add agent role definitions (orchestrator + 4 reviewers)"
```

---

### Task 7: Mock Tools

**Files:**
- Create: `code-agent-review/server/src/tools/orchestration.ts`
- Create: `code-agent-review/server/src/tools/review.ts`
- Create: `code-agent-review/server/src/tools/index.ts`

**Interfaces:**
- Consumes:
  - `agent/tool-registry.ts`: `Tool`, `toolRegistry`
- Produces:
  - All tools registered in `toolRegistry` via `registerAllTools()`

---

- [ ] **Step 1: Write orchestration tools**

Create `code-agent-review/server/src/tools/orchestration.ts`:

```typescript
import type { Tool } from '../agent/tool-registry'

const decomposeTask: Tool = {
  definition: {
    name: 'decomposeTask',
    description: 'Analyze code and decompose the review into 4 dimensions: security, performance, style, logic',
    parameters: {
      code: 'string - the code to review',
      language: 'string - the programming language'
    }
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    return JSON.stringify({
      dimensions: ['security', 'performance', 'style', 'logic'],
      subTasks: [
        { dimension: 'security', description: 'Check SQL injection, XSS, data exposure, auth issues' },
        { dimension: 'performance', description: 'Check N+1 queries, loop complexity, async patterns' },
        { dimension: 'style', description: 'Check naming, comments, structure, error handling' },
        { dimension: 'logic', description: 'Check boundaries, null safety, type safety, edge cases' }
      ]
    })
  }
}

const assignAgent: Tool = {
  definition: {
    name: 'assignAgent',
    description: 'Assign a sub-task to a specialist agent',
    parameters: {
      agentRole: 'string - the role: security, performance, style, or logic',
      subTask: 'string - description of the sub-task'
    }
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    return JSON.stringify({
      agentId: `agent-${input.agentRole}-${Date.now()}`,
      assigned: true,
      task: input.subTask
    })
  }
}

const collectResults: Tool = {
  definition: {
    name: 'collectResults',
    description: 'Collect all review findings from the agents',
    parameters: {
      taskId: 'string - the task ID'
    }
  },
  async execute(_input: Record<string, unknown>): Promise<string> {
    return JSON.stringify({
      results: [
        {
          agentRole: 'security',
          findings: [
            { line: 3, severity: 'critical', category: 'SQL Injection', message: 'User input concatenated into SQL query', suggestion: 'Use parameterized queries' }
          ]
        },
        {
          agentRole: 'performance',
          findings: [
            { line: 4, severity: 'warning', category: 'Synchronous Blocking', message: 'Database query may block the event loop', suggestion: 'Consider using async query method' }
          ]
        },
        {
          agentRole: 'style',
          findings: [
            { line: 1, severity: 'suggestion', category: 'Type Annotation', message: 'Missing type annotation on parameter', suggestion: 'Add explicit type: function getUser(id: string)' },
            { line: 1, severity: 'suggestion', category: 'Naming', message: 'Function name could be more descriptive', suggestion: "Rename to 'getUserById'" }
          ]
        },
        {
          agentRole: 'logic',
          findings: [
            { line: 2, severity: 'critical', category: 'Null Safety', message: 'Parameter id may be null or undefined', suggestion: 'Add a guard clause at function entry' }
          ]
        }
      ]
    })
  }
}

const generateReport: Tool = {
  definition: {
    name: 'generateReport',
    description: 'Generate the final structured review report',
    parameters: {
      taskId: 'string - the task ID',
      results: 'object - collected results from all agents'
    }
  },
  async execute(_input: Record<string, unknown>): Promise<string> {
    return JSON.stringify({
      reportId: `report-${Date.now()}`,
      score: 62,
      issues: [
        { line: 3, severity: 'critical', category: 'SQL Injection Risk', message: 'User input concatenated into query string', suggestion: 'Use parameterized queries instead' },
        { line: 2, severity: 'critical', category: 'Missing Null Check', message: "Parameter 'id' may be undefined or null", suggestion: 'Add guard clause at function entry' },
        { line: 1, severity: 'warning', category: 'Missing Type Annotation', message: 'Function parameter lacks explicit type', suggestion: 'Add: function getUser(id: string)' },
        { line: 1, severity: 'suggestion', category: 'Naming Convention', message: "Consider 'getUserById' for clarity", suggestion: "Rename function to 'getUserById'" }
      ]
    })
  }
}

export { decomposeTask, assignAgent, collectResults, generateReport }
```

- [ ] **Step 2: Write review tools**

Create `code-agent-review/server/src/tools/review.ts`:

```typescript
import type { Tool } from '../agent/tool-registry'

const analyzeCode: Tool = {
  definition: {
    name: 'analyzeCode',
    description: 'Analyze the code for issues in a specific dimension',
    parameters: {
      code: 'string - the code to analyze',
      dimension: 'string - review dimension: security, performance, style, logic'
    }
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const dimension = input.dimension as string

    const mockResults: Record<string, object> = {
      security: {
        issues: [
          { line: 3, severity: 'critical', category: 'SQL Injection', message: 'String concatenation in SQL query', suggestion: 'Use parameterized queries' }
        ],
        score: 60
      },
      performance: {
        issues: [
          { line: 4, severity: 'warning', category: 'Query Optimization', message: 'Query inside function may cause N+1 problem', suggestion: 'Consider batching queries' }
        ],
        score: 80
      },
      style: {
        issues: [
          { line: 1, severity: 'suggestion', category: 'Type Annotation', message: 'Missing parameter type', suggestion: 'Add type annotation' },
          { line: 1, severity: 'suggestion', category: 'Naming', message: 'Unclear function name', suggestion: 'Use more descriptive name' }
        ],
        score: 70
      },
      logic: {
        issues: [
          { line: 2, severity: 'critical', category: 'Null Check', message: 'Parameter may be null', suggestion: 'Add null guard' }
        ],
        score: 75
      }
    }

    return JSON.stringify(mockResults[dimension] || { issues: [], score: 100 })
  }
}

const checkPattern: Tool = {
  definition: {
    name: 'checkPattern',
    description: 'Check code against a specific pattern or rule',
    parameters: {
      code: 'string - the code to check',
      pattern: 'string - the pattern to check for (e.g. sql_injection, xss, naming)'
    }
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const pattern = input.pattern as string

    const mockResults: Record<string, object> = {
      sql_injection: { matches: [{ line: 3, pattern: 'string concatenation in SQL', description: 'User input directly concatenated into SQL string' }], count: 1 },
      xss: { matches: [], count: 0 },
      naming: { matches: [{ line: 1, pattern: 'short name', description: "Function name 'getUser' could be more descriptive" }], count: 1 },
      null_check: { matches: [{ line: 2, pattern: 'missing null guard', description: 'No null/undefined check on parameter before use' }], count: 1 }
    }

    return JSON.stringify(mockResults[pattern] || { matches: [], count: 0 })
  }
}

const validateLogic: Tool = {
  definition: {
    name: 'validateLogic',
    description: 'Validate the logic and check edge cases in the code',
    parameters: {
      code: 'string - the code to validate'
    }
  },
  async execute(_input: Record<string, unknown>): Promise<string> {
    return JSON.stringify({
      edgeCases: ['null input', 'undefined input', 'empty string input', 'non-string input', 'SQL injection attempt'],
      covered: [false, false, false, false, false],
      suggestions: [
        'Add null guard at function entry',
        'Add type check for id parameter',
        'Use parameterized queries to prevent SQL injection'
      ]
    })
  }
}

export { analyzeCode, checkPattern, validateLogic }
```

- [ ] **Step 3: Write tools index (register all)**

Create `code-agent-review/server/src/tools/index.ts`:

```typescript
import { toolRegistry } from '../agent/tool-registry'
import { decomposeTask, assignAgent, collectResults, generateReport } from './orchestration'
import { analyzeCode, checkPattern, validateLogic } from './review'

function registerAllTools(): void {
  // 编排工具
  toolRegistry.register(decomposeTask)
  toolRegistry.register(assignAgent)
  toolRegistry.register(collectResults)
  toolRegistry.register(generateReport)

  // 审查工具
  toolRegistry.register(analyzeCode)
  toolRegistry.register(checkPattern)
  toolRegistry.register(validateLogic)

  console.log(`[tools] Registered ${toolRegistry.getDefinitions().length} tools`)
}

export { registerAllTools }
```

- [ ] **Step 4: Commit**

```bash
git add server/src/tools/
git commit -m "feat: add mock tools (orchestration + review)"
```

---

### Task 8: Orchestrator

**Files:**
- Create: `code-agent-review/server/src/agent/orchestrator.ts`

**Interfaces:**
- Consumes:
  - `agent/types.ts`: `AgentRole`
  - `agent/roles/index.ts`: `getRolePrompt`
  - `agent/react-loop.ts`: `runReActLoop`, `StepCallback`
  - `agent/memory.ts`: `Memory`
  - `agent/tool-registry.ts`: `toolRegistry`
- Produces:
  - `agent/orchestrator.ts`: `runReviewTask(taskId, code, language, onEvent)` → `Promise<ReportContent>`

---

- [ ] **Step 1: Write Orchestrator**

Create `code-agent-review/server/src/agent/orchestrator.ts`:

```typescript
import { Memory } from './memory'
import { runReActLoop } from './react-loop'
import { getRolePrompt } from './roles/index'
import { toolRegistry } from './tool-registry'
import type { AgentRole, ReportContent } from '../../../shared/types'

interface ReviewEvent {
  type: string
  agentId?: string
  role?: string
  message?: string
  toolName?: string
  input?: Record<string, unknown>
  output?: string
  report?: ReportContent
}

async function runReviewTask(
  taskId: string,
  code: string,
  language: string,
  onEvent: (event: ReviewEvent) => void
): Promise<ReportContent> {
  // Step 1: Orchestrator 拆解任务
  onEvent({ type: 'orchestrator_start', message: 'Orchestrator analyzing code...' })

  const orchRole = getRolePrompt('orchestrator')
  const orchTools = toolRegistry.getDefinitions().filter(t =>
    ['decomposeTask', 'assignAgent', 'collectResults', 'generateReport'].includes(t.name)
  )

  const orchMemory = new Memory()
  orchMemory.add({ role: 'user', content: `Review this ${language} code:\n\`\`\`\n${code}\n\`\`\`` })

  const reviewerRoles: AgentRole[] = ['security', 'performance', 'style', 'logic']

  // Orchestrator 执行 ReAct 循环，逐步骤拆解、分派、收集、汇总
  const orchResult = await runReActLoop(orchRole, orchTools, orchMemory, (type, ...args) => {
    if (type === 'thought') {
      onEvent({ type: 'agent_thought', role: 'orchestrator', message: args[0] as string })
    } else if (type === 'tool_call') {
      onEvent({
        type: 'tool_call',
        role: 'orchestrator',
        toolName: args[0] as string,
        input: args[1] as Record<string, unknown>
      })
    }
  })

  // Step 2: 并行启动 4 个 Reviewer Agent
  onEvent({ type: 'task_decomposed', message: 'Dispatching reviewers...' })

  const reviewerResults: Record<string, { issues: unknown[]; score: number }> = {}

  await Promise.all(reviewerRoles.map(async (role) => {
    const reviewerId = `${role}-${taskId}`
    onEvent({ type: 'agent_start', agentId: reviewerId, role, message: `Started reviewing ${role} dimension` })

    const rolePrompt = getRolePrompt(role)
    const reviewTools = toolRegistry.getDefinitions().filter(t =>
      ['analyzeCode', 'checkPattern', 'validateLogic'].includes(t.name)
    )

    const mem = new Memory()
    mem.add({
      role: 'user',
      content: `Review this ${language} code for ${role} issues:\n\`\`\`\n${code}\n\`\`\``
    })

    try {
      const result = await runReActLoop(rolePrompt, reviewTools, mem, (type, ...args) => {
        if (type === 'thought') {
          onEvent({ type: 'agent_thought', agentId: reviewerId, role, message: args[0] as string })
        } else if (type === 'tool_call') {
          onEvent({
            type: 'tool_call',
            agentId: reviewerId,
            role,
            toolName: args[0] as string,
            input: args[1] as Record<string, unknown>
          })
          onEvent({
            type: 'tool_result',
            agentId: reviewerId,
            role,
            toolName: args[0] as string
          })
        }
      })

      let parsed: { issues: unknown[]; score: number }
      try {
        parsed = JSON.parse(result)
      } catch {
        parsed = { issues: [], score: 0 }
      }

      reviewerResults[role] = parsed
      onEvent({ type: 'agent_done', agentId: reviewerId, role, message: `Completed ${role} review` })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      onEvent({ type: 'error', agentId: reviewerId, role, message: errorMsg })
      reviewerResults[role] = { issues: [], score: 0 }
    }
  }))

  // Step 3: 汇总报告
  onEvent({ type: 'orchestrator_summary', message: 'Generating final report...' })

  const allIssues = Object.values(reviewerResults).flatMap(r => r.issues) as Array<{
    line: number
    severity: string
    category: string
    message: string
    suggestion: string
  }>

  const avgScore = Math.round(
    Object.values(reviewerResults).reduce((sum, r) => sum + r.score, 0) /
    Math.max(Object.values(reviewerResults).length, 1)
  )

  const report: ReportContent = {
    issues: allIssues,
    agentResults: reviewerResults as Record<AgentRole, { issues: { line: number; severity: string; category: string; message: string; suggestion: string }[]; score: number }>
  }

  onEvent({
    type: 'report_ready',
    report
  })
  onEvent({ type: 'task_completed' })

  return report
}

export { runReviewTask }
export type { ReviewEvent }
```

- [ ] **Step 2: Commit**

```bash
git add server/src/agent/orchestrator.ts
git commit -m "feat: add orchestrator with parallel agent execution"
```

---

### Task 9: Database Queries and Task Service

**Files:**
- Create: `code-agent-review/server/src/db/queries.ts`
- Create: `code-agent-review/server/src/services/taskService.ts`

**Interfaces:**
- Consumes:
  - `db/schema.ts`: `initDb`
  - `db/connection.ts`: `getDb`
  - `shared/types.ts`: all types
- Produces:
  - `db/queries.ts`: CRUD functions for all tables
  - `services/taskService.ts`: `createTask()`, `getTask()`, `saveAgentResult()`, `saveReport()`

---

- [ ] **Step 1: Write database queries**

Create `code-agent-review/server/src/db/queries.ts`:

```typescript
import { getDb } from './connection'
import type { Task, Agent, Message, ToolCall, Report } from '../../../shared/types'

// ── Tasks ──

function insertTask(task: Task): void {
  const db = getDb()
  const stmt = db.prepare(
    'INSERT INTO tasks (id, title, code_snippet, language, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
  stmt.run(task.id, task.title, task.codeSnippet, task.language, task.status, task.createdAt)
}

function updateTaskStatus(id: string, status: string): void {
  const db = getDb()
  db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, id)
}

function getTask(id: string): Task | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: row.id as string,
    title: row.title as string,
    codeSnippet: row.code_snippet as string,
    language: row.language as string,
    status: row.status as Task['status'],
    createdAt: row.created_at as string
  }
}

// ── Agents ──

function insertAgent(agent: Agent): void {
  const db = getDb()
  db.prepare(
    'INSERT INTO agents (id, task_id, role, status, model_name, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(agent.id, agent.taskId, agent.role, agent.status, agent.modelName, agent.createdAt)
}

function getAgentsByTask(taskId: string): Agent[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM agents WHERE task_id = ?').all(taskId) as Record<string, unknown>[]
  return rows.map(row => ({
    id: row.id as string,
    taskId: row.task_id as string,
    role: row.role as Agent['role'],
    status: row.status as Agent['status'],
    modelName: row.model_name as string,
    createdAt: row.created_at as string
  }))
}

// ── Messages ──

function insertMessage(message: Message): void {
  const db = getDb()
  db.prepare(
    'INSERT INTO messages (id, task_id, agent_id, role, content, type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(message.id, message.taskId, message.agentId, message.role, message.content, message.type, message.createdAt)
}

function getMessagesByTask(taskId: string): Message[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM messages WHERE task_id = ? ORDER BY created_at ASC').all(taskId) as Record<string, unknown>[]
  return rows.map(row => ({
    id: row.id as string,
    taskId: row.task_id as string,
    agentId: row.agent_id as string | null,
    role: row.role as Message['role'],
    content: row.content as string,
    type: row.type as Message['type'],
    createdAt: row.created_at as string
  }))
}

// ── Tool Calls ──

function insertToolCall(toolCall: ToolCall): void {
  const db = getDb()
  db.prepare(
    'INSERT INTO tool_calls (id, agent_id, message_id, tool_name, input, output, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(toolCall.id, toolCall.agentId, toolCall.messageId, toolCall.toolName, toolCall.input, toolCall.output, toolCall.createdAt)
}

// ── Reports ──

function insertReport(report: Report): void {
  const db = getDb()
  db.prepare(
    'INSERT OR REPLACE INTO reports (id, task_id, content, score, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(report.id, report.taskId, report.content, report.score, report.createdAt)
}

function getReportByTask(taskId: string): Report | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM reports WHERE task_id = ?').get(taskId) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    content: row.content as string,
    score: row.score as number,
    createdAt: row.created_at as string
  }
}

export {
  insertTask, updateTaskStatus, getTask,
  insertAgent, getAgentsByTask,
  insertMessage, getMessagesByTask,
  insertToolCall,
  insertReport, getReportByTask
}
```

- [ ] **Step 2: Write task service**

Create `code-agent-review/server/src/services/taskService.ts`:

```typescript
import { v4 as uuidv4 } from 'uuid'
import type { Task, Agent, Message, ReportContent, AgentRole } from '../../../shared/types'
import { insertTask, updateTaskStatus, getTask, insertAgent, insertMessage, insertReport, getReportByTask, getMessagesByTask, getAgentsByTask } from '../db/queries'

async function createTask(code: string, language: string, title?: string): Promise<Task> {
  const task: Task = {
    id: uuidv4(),
    title: title || `Code Review - ${new Date().toLocaleString()}`,
    codeSnippet: code,
    language,
    status: 'pending',
    createdAt: new Date().toISOString()
  }

  insertTask(task)
  return task
}

async function createAgentsForTask(taskId: string): Promise<void> {
  const roles: AgentRole[] = ['orchestrator', 'security', 'performance', 'style', 'logic']
  const modelName = process.env.LLM_MODEL || 'claude-sonnet-4-6'

  for (const role of roles) {
    const agent: Agent = {
      id: `${role}-${taskId}`,
      taskId,
      role,
      status: 'idle',
      modelName,
      createdAt: new Date().toISOString()
    }
    insertAgent(agent)
  }
}

async function saveReport(taskId: string, reportContent: ReportContent, score: number): Promise<void> {
  const report = {
    id: `report-${taskId}`,
    taskId,
    content: JSON.stringify(reportContent),
    score,
    createdAt: new Date().toISOString()
  }
  insertReport(report)
}

async function getTaskDetail(taskId: string): Promise<{
  task: Task | null
  agents: Agent[]
  messages: Message[]
  report: { content: ReportContent; score: number } | null
}> {
  const task = getTask(taskId)
  const agents = getAgentsByTask(taskId)
  const messages = getMessagesByTask(taskId)
  const report = getReportByTask(taskId)

  let reportData = null
  if (report) {
    reportData = {
      content: JSON.parse(report.content) as ReportContent,
      score: report.score
    }
  }

  return { task, agents, messages, report: reportData }
}

export { createTask, createAgentsForTask, saveReport, getTaskDetail, updateTaskStatus }
```

- [ ] **Step 3: Commit**

```bash
git add server/src/db/queries.ts server/src/services/taskService.ts
git commit -m "feat: add database queries and task service"
```

---

### Task 10: Express Routes and SSE

**Files:**
- Create: `code-agent-review/server/src/routes/tasks.ts`
- Modify: `code-agent-review/server/src/index.ts` (create)

**Interfaces:**
- Consumes:
  - `services/taskService.ts`: `createTask`, `createAgentsForTask`, `saveReport`, `getTaskDetail`, `updateTaskStatus`
  - `agent/orchestrator.ts`: `runReviewTask`
  - `tools/index.ts`: `registerAllTools`
  - `db/schema.ts`: `initDb`
- Produces:
  - Express server on port 3001

---

- [ ] **Step 1: Write Express entry point**

Create `code-agent-review/server/src/index.ts`:

```typescript
import express from 'express'
import cors from 'cors'
import { initDb } from './db/schema'
import { registerAllTools } from './tools/index'
import { tasksRouter } from './routes/tasks'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

// 初始化数据库
initDb()
console.log('[db] Database initialized')

// 注册所有工具
registerAllTools()

// 路由
app.use('/api/tasks', tasksRouter)

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.listen(PORT, () => {
  console.log(`[server] Running on http://localhost:${PORT}`)
})
```

- [ ] **Step 2: Write tasks router with SSE**

Create `code-agent-review/server/src/routes/tasks.ts`:

```typescript
import { Router, type Request, type Response } from 'express'
import { createTask, createAgentsForTask, saveReport, getTaskDetail, updateTaskStatus } from '../services/taskService'
import { runReviewTask } from '../agent/orchestrator'
import type { ReviewEvent } from '../agent/orchestrator'

const tasksRouter = Router()

// POST /api/tasks - 创建审查任务
tasksRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { code, language, title } = req.body

    if (!code || !language) {
      res.status(400).json({ error: 'code and language are required' })
      return
    }

    const task = await createTask(code, language, title)
    await createAgentsForTask(task.id)

    res.status(201).json(task)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// GET /api/tasks/:id - 获取任务详情
tasksRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const detail = await getTaskDetail(req.params.id)
    if (!detail.task) {
      res.status(404).json({ error: 'Task not found' })
      return
    }
    res.json(detail)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

// GET /api/tasks/:id/stream - SSE 实时推送
tasksRouter.get('/:id/stream', async (req: Request, res: Response) => {
  const taskId = req.params.id

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  })

  function sendEvent(event: string, data: unknown): void {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  // 获取任务信息
  const detail = await getTaskDetail(taskId)
  if (!detail.task) {
    sendEvent('error', { message: 'Task not found' })
    res.end()
    return
  }

  // 更新状态
  updateTaskStatus(taskId, 'orchestrating')

  try {
    const reportContent = await runReviewTask(
      taskId,
      detail.task.codeSnippet,
      detail.task.language,
      (event: ReviewEvent) => {
        sendEvent(event.type, event)
      }
    )

    // 保存报告
    const score = reportContent.agentResults
      ? Math.round(
          Object.values(reportContent.agentResults).reduce((sum: number, r: { score: number }) => sum + r.score, 0) /
          Math.max(Object.values(reportContent.agentResults).length, 1)
        )
      : 0

    await saveReport(taskId, reportContent, score)
    updateTaskStatus(taskId, 'completed')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    sendEvent('error', { message })
    updateTaskStatus(taskId, 'failed')
  }

  res.end()
})

export { tasksRouter }
```

- [ ] **Step 3: Verify server starts**

```bash
cd code-agent-review/server
npm run dev
```

Expected: `[server] Running on http://localhost:3001`, `[db] Database initialized`, `[tools] Registered 7 tools`

Stop with Ctrl+C after verification.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts server/src/routes/tasks.ts
git commit -m "feat: add express server with SSE streaming"
```

---

### Task 11: Frontend Setup

**Files:**
- Modify: `code-agent-review/client/src/main.ts`
- Modify: `code-agent-review/client/src/App.vue`
- Create: `code-agent-review/client/src/styles/main.css`
- Create: `code-agent-review/client/vite.config.ts` (if not exists)

**Interfaces:**
- Produces: Working Vue 3 app with Element Plus, Pinia, Axios

---

- [ ] **Step 1: Install frontend dependencies**

```bash
cd code-agent-review/client
npm install element-plus pinia axios
```

- [ ] **Step 2: Write main.ts**

Overwrite `code-agent-review/client/src/main.ts`:

```typescript
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import './styles/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(ElementPlus)
app.mount('#app')
```

- [ ] **Step 3: Write global styles**

Create `code-agent-review/client/src/styles/main.css`:

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background: #f5f5f5;
  color: #303133;
}

#app {
  max-width: 800px;
  margin: 0 auto;
  min-height: 100vh;
  background: #ffffff;
  box-shadow: 0 0 20px rgba(0, 0, 0, 0.05);
}
```

- [ ] **Step 4: Write App.vue skeleton**

Overwrite `code-agent-review/client/src/App.vue`:

```vue
<script setup lang="ts">
// ChatView 将在 Task 13 替换这里的占位内容
</script>

<template>
  <div class="app-container">
    <header class="app-header">
      <h1>CodeAgentReview</h1>
      <span class="app-subtitle">Multi-Agent Code Review</span>
    </header>
    <main class="app-main">
      <p style="color: #909399; text-align: center; padding: 40px;">
        Frontend scaffold ready. Components will be added in Task 13.
      </p>
    </main>
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-header {
  padding: 20px 24px;
  border-bottom: 1px solid #ebeef5;
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.app-header h1 {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
}

.app-subtitle {
  font-size: 13px;
  color: #909399;
}

.app-main {
  flex: 1;
  padding: 24px;
}
</style>
```

- [ ] **Step 5: Verify frontend starts**

```bash
cd code-agent-review/client
npm run dev
```

Expected: Vite dev server starts, page shows "CodeAgentReview" header.

Stop with Ctrl+C after verification.

- [ ] **Step 6: Commit**

```bash
git add client/src/main.ts client/src/App.vue client/src/styles/main.css client/vite.config.ts
git commit -m "feat: setup vue 3 frontend with element plus and pinia"
```

---

### Task 12: Pinia Store and SSE Composable

**Files:**
- Create: `code-agent-review/client/src/stores/review.ts`
- Create: `code-agent-review/client/src/composables/useSSE.ts`
- Create: `code-agent-review/client/src/composables/useChat.ts`
- Create: `code-agent-review/client/src/types/index.ts`

**Interfaces:**
- Consumes: Server SSE events
- Produces:
  - `stores/review.ts`: Pinia store with `messages`, `status`, `report`, `startReview(code, language)`, `addMessage(msg)`
  - `composables/useSSE.ts`: SSE connection hook
  - `composables/useChat.ts`: Chat state management

---

- [ ] **Step 1: Write frontend types**

Create `code-agent-review/client/src/types/index.ts`:

```typescript
type TaskStatus = 'pending' | 'orchestrating' | 'reviewing' | 'summarizing' | 'completed' | 'failed'
type AgentRole = 'orchestrator' | 'security' | 'performance' | 'style' | 'logic'
type Severity = 'critical' | 'warning' | 'suggestion'

interface Issue {
  line: number
  severity: Severity
  category: string
  message: string
  suggestion: string
}

interface ChatMessage {
  id: string
  role: AgentRole | 'user' | 'system'
  content: string
  type: 'user_input' | 'agent_thought' | 'tool_call' | 'tool_result' | 'final_answer' | 'report'
  timestamp: string
  toolName?: string
  report?: ReviewReport
}

interface ReviewReport {
  issues: Issue[]
  score: number
  agentResults: Record<string, { issues: Issue[]; score: number }>
}

interface ReviewState {
  taskId: string | null
  status: TaskStatus
  messages: ChatMessage[]
}

export type { TaskStatus, AgentRole, Severity, Issue, ChatMessage, ReviewReport, ReviewState }
```

- [ ] **Step 2: Write Pinia store**

Create `code-agent-review/client/src/stores/review.ts`:

```typescript
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ChatMessage, ReviewState, TaskStatus } from '../types/index'

export const useReviewStore = defineStore('review', () => {
  const taskId = ref<string | null>(null)
  const status = ref<TaskStatus>('pending')
  const messages = ref<ChatMessage[]>([])
  const loading = ref(false)

  function addMessage(msg: Omit<ChatMessage, 'id' | 'timestamp'>) {
    messages.value.push({
      ...msg,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false })
    })
  }

  function setStatus(newStatus: TaskStatus) {
    status.value = newStatus
  }

  function setTaskId(id: string) {
    taskId.value = id
  }

  function reset() {
    taskId.value = null
    status.value = 'pending'
    messages.value = []
    loading.value = false
  }

  return { taskId, status, messages, loading, addMessage, setStatus, setTaskId, reset }
})
```

- [ ] **Step 3: Write SSE composable**

Create `code-agent-review/client/src/composables/useSSE.ts`:

```typescript
import { useReviewStore } from '../stores/review'
import type { ChatMessage } from '../types/index'

export function useSSE() {
  const store = useReviewStore()
  let eventSource: EventSource | null = null

  function connect(taskId: string) {
    const url = `http://localhost:3001/api/tasks/${taskId}/stream`
    eventSource = new EventSource(url)

    const eventHandlers: Record<string, (data: Record<string, unknown>) => void> = {
      orchestrator_start: (data) => {
        store.setStatus('orchestrating')
        store.addMessage({
          role: 'orchestrator',
          content: typeof data.message === 'string' ? data.message : 'Starting review...',
          type: 'agent_thought'
        })
      },

      agent_start: (data) => {
        store.setStatus('reviewing')
        store.addMessage({
          role: (data.role as ChatMessage['role']) || 'system',
          content: typeof data.message === 'string' ? data.message : 'Started reviewing...',
          type: 'agent_thought'
        })
      },

      agent_thought: (data) => {
        store.addMessage({
          role: (data.role as ChatMessage['role']) || 'system',
          content: typeof data.message === 'string' ? data.message : 'Thinking...',
          type: 'agent_thought'
        })
      },

      tool_call: (data) => {
        store.addMessage({
          role: (data.role as ChatMessage['role']) || 'system',
          content: `Calling ${data.toolName}...`,
          type: 'tool_call',
          toolName: typeof data.toolName === 'string' ? data.toolName : undefined
        })
      },

      agent_done: (data) => {
        store.addMessage({
          role: (data.role as ChatMessage['role']) || 'system',
          content: typeof data.message === 'string' ? data.message : 'Review completed',
          type: 'final_answer'
        })
      },

      report_ready: (data) => {
        store.setStatus('completed')
        const report = data.report as Record<string, unknown>
        store.addMessage({
          role: 'system',
          content: 'Review completed',
          type: 'report',
          report: {
            issues: (report?.issues as Array<Record<string, unknown>> || []).map(i => ({
              line: i.line as number,
              severity: i.severity as 'critical' | 'warning' | 'suggestion',
              category: i.category as string,
              message: i.message as string,
              suggestion: i.suggestion as string
            })),
            score: (report?.score as number) || 0,
            agentResults: (report?.agentResults as Record<string, { issues: Array<Record<string, unknown>>; score: number }>) || {}
          }
        })
      },

      task_completed: () => {
        store.setStatus('completed')
        store.loading = false
      },

      error: (data) => {
        store.addMessage({
          role: 'system',
          content: `Error: ${typeof data.message === 'string' ? data.message : 'Unknown error'}`,
          type: 'agent_thought'
        })
        store.setStatus('failed')
        store.loading = false
      }
    }

    eventSource.onmessage = (event) => {
      // 处理未命名事件（SSE data-only messages）
    }

    // 为每个事件类型注册监听
    Object.keys(eventHandlers).forEach(eventType => {
      eventSource!.addEventListener(eventType, (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data)
          eventHandlers[eventType](data)
        } catch {
          eventHandlers[eventType](event.data)
        }
      })
    })

    eventSource.onerror = () => {
      store.loading = false
      store.setStatus('failed')
      eventSource?.close()
    }
  }

  function disconnect() {
    eventSource?.close()
    eventSource = null
  }

  return { connect, disconnect }
}
```

- [ ] **Step 4: Write useChat composable**

Create `code-agent-review/client/src/composables/useChat.ts`:

```typescript
import { ref } from 'vue'
import axios from 'axios'
import { useReviewStore } from '../stores/review'
import { useSSE } from './useSSE'

const API_BASE = 'http://localhost:3001/api'

export function useChat() {
  const store = useReviewStore()
  const { connect, disconnect } = useSSE()
  const codeInput = ref('')
  const language = ref('typescript')

  async function startReview(code: string, lang: string) {
    store.reset()
    store.loading = true

    store.addMessage({
      role: 'user',
      content: `Submitted ${lang} code for review`,
      type: 'user_input'
    })

    try {
      const response = await axios.post(`${API_BASE}/tasks`, {
        code,
        language: lang,
        title: `Review - ${new Date().toLocaleTimeString()}`
      })

      const taskId = response.data.id
      store.setTaskId(taskId)
      connect(taskId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create task'
      store.addMessage({
        role: 'system',
        content: `Error: ${message}`,
        type: 'agent_thought'
      })
      store.loading = false
    }
  }

  return { codeInput, language, startReview, disconnect }
}
```

- [ ] **Step 5: Commit**

```bash
git add client/src/stores/ client/src/composables/ client/src/types/
git commit -m "feat: add pinia store, sse composable, and chat hook"
```

---

### Task 13: Frontend Components

**Files:**
- Create: `code-agent-review/client/src/components/ChatView.vue`
- Create: `code-agent-review/client/src/components/ChatMessage.vue`
- Create: `code-agent-review/client/src/components/CodeInput.vue`
- Create: `code-agent-review/client/src/components/ReviewReport.vue`

**Interfaces:**
- Consumes:
  - `stores/review.ts`: `useReviewStore`
  - `composables/useChat.ts`: `useChat`
- Produces: Full chat UI with code input, agent messages, and review report

---

- [ ] **Step 1: Write ChatView (main container)**

Create `code-agent-review/client/src/components/ChatView.vue`:

```vue
<script setup lang="ts">
import { useReviewStore } from '../stores/review'
import { useChat } from '../composables/useChat'
import CodeInput from './CodeInput.vue'
import ChatMessage from './ChatMessage.vue'
import ReviewReport from './ReviewReport.vue'

const store = useReviewStore()
const { startReview } = useChat()
</script>

<template>
  <div class="chat-view">
    <!-- 消息列表 -->
    <div class="message-list" v-if="store.messages.length > 0 || store.loading">
      <template v-for="msg in store.messages" :key="msg.id">
        <ChatMessage :message="msg" />
        <ReviewReport v-if="msg.type === 'report' && msg.report" :report="msg.report" />
      </template>

      <!-- 加载状态 -->
      <div v-if="store.loading" class="loading-indicator">
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="input-area" :class="{ 'input-compact': store.messages.length > 0 }">
      <CodeInput :disabled="store.loading" @submit="startReview" />
    </div>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.loading-indicator {
  display: flex;
  gap: 6px;
  padding: 8px 0;
}

.loading-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #409eff;
  animation: pulse 1.4s ease-in-out infinite;
}

.loading-dot:nth-child(2) { animation-delay: 0.2s; }
.loading-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes pulse {
  0%, 80%, 100% { opacity: 0.3; }
  40% { opacity: 1; }
}

.input-area {
  padding-top: 40px;
}

.input-compact {
  padding-top: 16px;
  border-top: 1px solid #ebeef5;
}
</style>
```

- [ ] **Step 2: Write CodeInput**

Create `code-agent-review/client/src/components/CodeInput.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  disabled: boolean
}>()

const emit = defineEmits<{
  submit: [code: string, language: string]
}>()

const code = ref('')
const language = ref('typescript')

const languages = [
  { label: 'TypeScript', value: 'typescript' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'Python', value: 'python' },
  { label: 'Java', value: 'java' },
  { label: 'Go', value: 'go' }
]

function handleSubmit() {
  if (!code.value.trim()) return
  emit('submit', code.value, language.value)
}
</script>

<template>
  <div class="code-input">
    <div class="input-header">
      <label class="input-label">Language</label>
      <el-select v-model="language" size="small" :disabled="disabled" class="lang-select">
        <el-option
          v-for="lang in languages"
          :key="lang.value"
          :label="lang.label"
          :value="lang.value"
        />
      </el-select>
    </div>

    <el-input
      v-model="code"
      type="textarea"
      :rows="8"
      :disabled="disabled"
      placeholder="Paste your code here..."
      class="code-textarea"
    />

    <el-button
      type="primary"
      :disabled="disabled || !code.trim()"
      :loading="disabled"
      @click="handleSubmit"
      class="submit-btn"
    >
      Start Review
    </el-button>
  </div>
</template>

<style scoped>
.code-input {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.input-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.input-label {
  font-size: 13px;
  font-weight: 500;
  color: #606266;
}

.lang-select {
  width: 160px;
}

.code-textarea :deep(textarea) {
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.6;
}

.submit-btn {
  align-self: flex-start;
}
</style>
```

- [ ] **Step 3: Write ChatMessage**

Create `code-agent-review/client/src/components/ChatMessage.vue`:

```vue
<script setup lang="ts">
import type { ChatMessage as ChatMessageType } from '../types/index'

defineProps<{
  message: ChatMessageType
}>()

function getRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    user: 'You',
    orchestrator: 'Orchestrator',
    security: 'Security Reviewer',
    performance: 'Performance Reviewer',
    style: 'Style Reviewer',
    logic: 'Logic Reviewer',
    system: 'System'
  }
  return labels[role] || role
}

function getRoleClass(role: string): string {
  if (role === 'user') return 'role-user'
  if (role === 'orchestrator') return 'role-orch'
  return 'role-agent'
}
</script>

<template>
  <div class="chat-message" :class="getRoleClass(message.role)">
    <div class="message-header">
      <span class="message-role">{{ getRoleLabel(message.role) }}</span>
      <span class="message-time">{{ message.timestamp }}</span>
    </div>
    <div class="message-body">
      <div class="message-line"></div>
      <div class="message-content">
        <p v-if="message.type !== 'tool_call'">{{ message.content }}</p>
        <p v-else class="tool-call">
          <span class="tool-name">Tool: {{ message.toolName }}</span>
          {{ message.content }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-message {
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.message-role {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.role-orch .message-role {
  color: #409eff;
}

.role-agent .message-role {
  color: #67c23a;
}

.role-user .message-role {
  color: #e6a23c;
}

.message-time {
  font-size: 11px;
  color: #c0c4cc;
}

.message-body {
  display: flex;
  gap: 12px;
}

.message-line {
  width: 2px;
  min-width: 2px;
  background: #e4e7ed;
  border-radius: 1px;
}

.role-orch .message-line {
  background: #409eff;
}

.role-agent .message-line {
  background: #67c23a;
}

.role-user .message-line {
  background: #e6a23c;
}

.message-content {
  font-size: 14px;
  line-height: 1.7;
  color: #606266;
}

.tool-call {
  font-size: 13px;
  color: #909399;
}

.tool-name {
  display: inline-block;
  background: #ecf5ff;
  color: #409eff;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 12px;
  margin-right: 6px;
}
</style>
```

- [ ] **Step 4: Write ReviewReport**

Create `code-agent-review/client/src/components/ReviewReport.vue`:

```vue
<script setup lang="ts">
import type { ReviewReport as ReviewReportType } from '../types/index'

defineProps<{
  report: ReviewReportType
}>()

function getSeverityClass(severity: string): string {
  if (severity === 'critical') return 'sev-critical'
  if (severity === 'warning') return 'sev-warning'
  return 'sev-suggestion'
}

function getSeverityLabel(severity: string): string {
  if (severity === 'critical') return 'Critical'
  if (severity === 'warning') return 'Warning'
  return 'Suggestion'
}
</script>

<template>
  <div class="review-report">
    <div class="report-header">
      <span class="report-title">Review Report</span>
      <span class="report-score">Overall Score: {{ report.score }} / 100</span>
    </div>

    <div class="report-section" v-for="(severity, sevKey) in { critical: 'Critical', warning: 'Warning', suggestion: 'Suggestion' }" :key="sevKey">
      <template v-if="report.issues.filter(i => i.severity === sevKey).length > 0">
        <div class="section-title" :class="getSeverityClass(sevKey)">-- {{ severity }} --</div>
        <div
          v-for="(issue, idx) in report.issues.filter(i => i.severity === sevKey)"
          :key="idx"
          class="issue-card"
        >
          <div class="issue-header">
            <span class="issue-loc">Line {{ issue.line }}</span>
            <span class="issue-category">{{ issue.category }}</span>
            <el-tag
              :type="sevKey === 'critical' ? 'danger' : sevKey === 'warning' ? 'warning' : 'info'"
              size="small"
            >
              {{ getSeverityLabel(sevKey) }}
            </el-tag>
          </div>
          <p class="issue-message">{{ issue.message }}</p>
          <p class="issue-suggestion">{{ issue.suggestion }}</p>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.review-report {
  background: #fafafa;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 20px;
}

.report-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid #ebeef5;
}

.report-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.report-score {
  font-size: 14px;
  font-weight: 500;
  color: #409eff;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  margin: 16px 0 8px;
  color: #606266;
}

.sev-critical { color: #f56c6c; }
.sev-warning { color: #e6a23c; }
.sev-suggestion { color: #909399; }

.issue-card {
  background: #ffffff;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 12px 16px;
  margin-bottom: 8px;
}

.issue-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.issue-loc {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: #909399;
}

.issue-category {
  font-size: 13px;
  font-weight: 500;
  color: #303133;
  flex: 1;
}

.issue-message {
  font-size: 14px;
  color: #606266;
  margin-bottom: 4px;
}

.issue-suggestion {
  font-size: 13px;
  color: #67c23a;
  font-style: italic;
}
</style>
```

- [ ] **Step 5: Verify the full frontend**

```bash
cd code-agent-review/client
npm run dev
```

Expected: Full chat UI rendered, code input works, Start Review button present.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/
git commit -m "feat: add chat ui components (input, message, report)"
```

---

### Task 14: Integration and Environment Config

**Files:**
- Create: `code-agent-review/.env.example`
- Modify: `code-agent-review/server/src/agent/llm-client.ts` — use env vars
- Create: `code-agent-review/README.md`

**Interfaces:**
- Produces: Working end-to-end flow

---

- [ ] **Step 1: Write .env.example**

Create `code-agent-review/.env.example`:

```
# LLM API Configuration
LLM_API_KEY=your-api-key-here
LLM_BASE_URL=https://api.anthropic.com
LLM_MODEL=claude-sonnet-4-6

# Server
PORT=3001
```

- [ ] **Step 2: Add dotenv loading to server**

Install dotenv and update server entry:

```bash
cd code-agent-review/server
npm install dotenv
```

Add to the very top of `code-agent-review/server/src/index.ts`:

```typescript
import 'dotenv/config'
```

(file already exists, insert at line 1)

- [ ] **Step 3: Write README**

Create `code-agent-review/README.md`:

```markdown
# CodeAgentReview

Multi-Agent Code Review Platform — a TypeScript full-stack application demonstrating hand-written agent orchestration.

## Architecture

- **Frontend**: Vue 3 + Element Plus + Pinia
- **Backend**: Express 4 + better-sqlite3
- **Agent Engine**: Hand-written ReAct loop with Tool Calling
- **LLM**: Claude API / OpenAI API (configurable)

## Quick Start

```bash
# Install dependencies
npm install
npm run install:all

# Copy and configure environment
cp .env.example .env
# Edit .env with your LLM API key

# Start development
npm run dev
```

Frontend: http://localhost:5173
Backend: http://localhost:3001

## Project Structure

```
├── client/           Vue 3 frontend
│   └── src/
│       ├── components/   UI components
│       ├── composables/  SSE + Chat hooks
│       └── stores/       Pinia store
├── server/           Express backend
│   └── src/
│       ├── agent/        Agent engine (core)
│       │   ├── roles/    Agent role prompts
│       │   ├── react-loop.ts
│       │   ├── orchestrator.ts
│       │   ├── llm-client.ts
│       │   └── tool-registry.ts
│       ├── tools/        Mock tool implementations
│       ├── db/           SQLite schema + queries
│       ├── routes/       Express routes
│       └── services/     Business logic
└── shared/           Shared TypeScript types
```
```

- [ ] **Step 4: End-to-end smoke test**

```bash
# Terminal 1: Start backend
cd code-agent-review/server
cp ../.env.example ../.env  # Use mock/empty values for smoke test
npm run dev

# Terminal 2: Start frontend
cd code-agent-review/client
npm run dev
```

Expected:
- Backend starts on port 3001
- Frontend starts on port 5173
- Browser shows the chat interface
- Can paste code and click Start Review
- (Without real LLM API key, will show error — this is expected)

- [ ] **Step 5: Commit**

```bash
git add .env.example README.md server/src/index.ts
git commit -m "docs: add readme and environment config"
```

---

## Post-Implementation

After all tasks complete:

1. Set real LLM API key in `.env`
2. Run full flow: paste code → see all 5 agents work → receive report
3. Polish based on actual LLM behavior (prompt tuning)
4. Deploy frontend to Vercel, backend to Railway
