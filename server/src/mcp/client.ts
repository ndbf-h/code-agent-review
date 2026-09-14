import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { toolRegistry, type Tool } from '../agent/tool-registry'
import { createLogger } from '../logger'

const logger = createLogger('mcp-client')

/**
 * MCP Client：启动时连接 MCP_CLIENT_SERVERS 列出的外部 MCP Server，
 * 把远端工具以 `mcp_<别名>_<工具名>` 注册进 toolRegistry —— orchestrator 的
 * ReAct 循环零改动即可调用外部工具（工具清单对 LLM 的呈现与本地工具一致）。
 *
 * 命名用下划线而非冒号：OpenAI/兼容网关的 tool name 约束为 ^[a-zA-Z0-9_-]{1,64}$。
 * 连接失败仅告警（外部服务缺席是常态），不阻塞进程启动。
 */

interface McpServerEntry {
  alias: string
  url: string
}

export function parseMcpServerList(raw: string | undefined): McpServerEntry[] {
  if (!raw) return []
  return raw
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const eq = entry.indexOf('=')
      if (eq > 0) {
        return { alias: sanitize(entry.slice(0, eq)), url: entry.slice(eq + 1).trim() }
      }
      try {
        const host = new URL(entry).hostname.replace(/\./g, '_')
        return { alias: sanitize(host), url: entry }
      } catch {
        return { alias: 'remote', url: entry }
      }
    })
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24) || 'remote'
}

/** 远端 JSON Schema → 项目 ToolDefinition.parameters 约定结构（{name: {type, description}}） */
function toConventionParameters(inputSchema: unknown): Record<string, unknown> {
  const schema = (inputSchema && typeof inputSchema === 'object' ? inputSchema : {}) as {
    properties?: Record<string, { type?: string; description?: string }>
  }
  const parameters: Record<string, unknown> = {}
  for (const [key, prop] of Object.entries(schema.properties || {})) {
    parameters[key] = { type: prop.type || 'string', description: prop.description || '' }
  }
  return parameters
}

async function mountSingleServer(entry: McpServerEntry): Promise<number> {
  const client = new Client({ name: 'code-agent-review-client', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(entry.url))
  await client.connect(transport)

  const { tools } = await client.listTools()
  let registered = 0
  for (const tool of tools) {
    const remoteName = `mcp_${entry.alias}_${tool.name}`
    if (toolRegistry.get(remoteName)) continue
    const adapter: Tool = {
      definition: {
        name: remoteName,
        description: `[MCP:${entry.alias}] ${tool.description || tool.name}`,
        parameters: toConventionParameters(tool.inputSchema)
      },
      execute: async input => {
        const result = await client.callTool({ name: tool.name, arguments: input })
        const content = (result.content as Array<{ type: string; text?: string }> | undefined) || []
        if (result.isError) {
          throw new Error(content.map(c => c.text || '').join('\n') || 'MCP 工具执行失败')
        }
        return content.map(c => c.text || '').join('\n') || JSON.stringify(result)
      }
    }
    toolRegistry.register(adapter)
    registered++
  }
  return registered
}

/** 启动时调用（registerAllTools 之后）：挂载所有配置的外部 MCP Server */
export async function mountExternalMcpTools(): Promise<void> {
  const entries = parseMcpServerList(process.env.MCP_CLIENT_SERVERS)
  if (entries.length === 0) return

  await Promise.all(
    entries.map(async entry => {
      try {
        const count = await mountSingleServer(entry)
        logger.info('已挂载外部 MCP Server 工具', {
          url: entry.url,
          tools: count,
          prefix: `mcp_${entry.alias}_`
        })
      } catch (error) {
        logger.warn('连接外部 MCP Server 失败，跳过', { url: entry.url, error })
      }
    })
  )
}
