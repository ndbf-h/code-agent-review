import { LlmClient, llmClient } from './llm-client'
import { createLogger } from '../logger'
import { getConfig } from '../config'

const logger = createLogger('role-router')

/**
 * 按角色路由 LLM 客户端：不同审查维度可用不同模型（如 security 用强模型、style 用便宜模型）。
 *
 * 配置格式（ROLE_MODELS，逗号分隔）：
 *   ROLE_MODELS=security=deepseek-reasoner, style=deepseek-chat
 *   ROLE_MODELS=security=sf:deepseek-ai/DeepSeek-V3     # 跨 provider：alias:model
 *
 * 跨 provider 时从 LLM_ROUTE_<ALIAS>_BASE_URL / LLM_ROUTE_<ALIAS>_API_KEY 读取该
 * provider 的端点与密钥（OpenAI 兼容），未配置则退化为仅换模型名。
 * 未出现在 ROLE_MODELS 中的角色使用全局默认单例。
 */

export interface RoleRouteSpec {
  model: string
  baseUrl?: string
  apiKey?: string
}

export interface ParsedRoleModels {
  [role: string]: RoleRouteSpec
}

/** LLM_ROUTE_<别名>_* 端点表（键为大写别名），由 config.roleRouting.routes 提供 */
export type RoleRouteEndpoints = Record<string, { baseUrl?: string; apiKey?: string }>

/** 解析 ROLE_MODELS 配置字符串（纯函数，便于单测） */
export function parseRoleModels(
  raw: string | undefined,
  endpoints: RoleRouteEndpoints = {}
): ParsedRoleModels {
  if (!raw) return {}
  const result: ParsedRoleModels = {}
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) {
      logger.warn(`ROLE_MODELS 条目格式非法（应为 role=model），已忽略: ${trimmed}`)
      continue
    }
    const role = trimmed.slice(0, eq).trim()
    const model = trimmed.slice(eq + 1).trim()
    if (!role || !model) continue

    const spec: RoleRouteSpec = { model }
    const at = model.indexOf(':')
    if (at > 0) {
      // alias:model —— 解析跨 provider 路由
      const alias = model.slice(0, at).toUpperCase()
      const aliasModel = model.slice(at + 1)
      const baseUrl = endpoints[alias]?.baseUrl
      const apiKey = endpoints[alias]?.apiKey
      if (baseUrl && apiKey) {
        spec.model = aliasModel
        spec.baseUrl = baseUrl.replace(/\/$/, '')
        spec.apiKey = apiKey
      } else {
        logger.warn(`路由别名 ${alias} 缺少 LLM_ROUTE_${alias}_BASE_URL/_API_KEY，退化为仅换模型`)
      }
    }
    result[role] = spec
  }
  return result
}

const clientCache = new Map<string, LlmClient>()

export function resetRoleRouter(): void {
  clientCache.clear()
}

/** 获取角色对应的 LLM 客户端：无路由配置时返回全局单例（零开销路径） */
export function getClientForRole(role: string): LlmClient {
  const { roleModels, routes: endpoints } = getConfig().roleRouting
  const routes = parseRoleModels(roleModels, endpoints)
  const spec = routes[role]
  if (!spec) return llmClient

  const cacheKey = `${role}=${spec.model}@${spec.baseUrl || 'default'}`
  let client = clientCache.get(cacheKey)
  if (!client) {
    client = new LlmClient({
      model: spec.model,
      ...(spec.baseUrl ? { baseUrl: spec.baseUrl } : {}),
      ...(spec.apiKey ? { apiKey: spec.apiKey } : {})
    })
    clientCache.set(cacheKey, client)
    logger.info(`角色路由: ${role} → ${spec.model}${spec.baseUrl ? ` @ ${spec.baseUrl}` : ''}`)
  }
  return client
}
