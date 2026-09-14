import express, { type Express, type Request, type Response } from 'express'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { toolRegistry } from '../agent/tool-registry'
import { toInputSchema, NON_READONLY_TOOLS } from './schema'

const TOOL_CALL_TIMEOUT_MS = 120_000

/**
 * MCP Server：把 toolRegistry 的工具经 Streamable HTTP 暴露给外部 Agent 客户端
 * （Claude Code / Cursor 等）。
 *
 * - ListTools 直接返回原生 JSON Schema（不走 SDK 的 zod registerTool 路径，契约完全可控）；
 * - CallTool 直接调 tool.execute，绕开 toolRegistry.execute 的 5s 硬超时
 *   （applyFixes 走 LLM 常超 5s），另加 120s 上限保护 transport；
 * - 无状态模式（每请求一个 transport）：本服务不需要 server→client 的主动推送，
 *   GET/DELETE 返回 405 符合 Streamable HTTP 规范。
 */

function buildMcpServer(): Server {
  const server = new Server(
    { name: 'code-agent-review', version: '1.0.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolRegistry.getDefinitions().map(def => ({
      name: def.name,
      description: def.description,
      inputSchema: toInputSchema(def.name, def.parameters),
      annotations: {
        readOnlyHint: !NON_READONLY_TOOLS.has(def.name)
      }
    }))
  }))

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const name = request.params.name
    const tool = toolRegistry.get(name)
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true
      }
    }
    try {
      const result = await Promise.race([
        tool.execute((request.params.arguments || {}) as Record<string, unknown>),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`工具执行超时（${TOOL_CALL_TIMEOUT_MS / 1000}s）`)),
            TOOL_CALL_TIMEOUT_MS
          )
        )
      ])
      return { content: [{ type: 'text', text: result }] }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { content: [{ type: 'text', text: `工具执行失败: ${message}` }], isError: true }
    }
  })

  return server
}

/**
 * 挂载 /mcp 端点。必须在全局 express.json() 之前调用：
 * MCP 端点自管 body 解析，避免全局 parser 预读请求流导致 transport 拿不到原始 body。
 * 工具清单在请求时惰性读取 toolRegistry，挂载早于 registerAllTools() 没有问题。
 */
export function mountMcpEndpoint(app: Express): void {
  app.use('/mcp', express.json({ limit: '2mb' }))

  app.post('/mcp', async (req: Request, res: Response) => {
    const server = buildMcpServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message } })
      }
    }
  })

  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed（本服务为无状态模式，不支持 SSE 流/会话终止）'
      }
    })
  }
  app.get('/mcp', methodNotAllowed)
  app.delete('/mcp', methodNotAllowed)
}
