/**
 * 应用配置模块
 * 统一管理所有环境变量配置，包含启动时校验
 */

export interface AppConfig {
  port: number
  dbPath: string
  llm: {
    apiKey: string
    baseUrl: string
    model: string
    provider: string
    maxRetries: number
  }
  maxConcurrentTasks: number
}

/**
 * 从环境变量加载配置，校验必要字段
 * LLM_API_KEY 缺失时直接退出进程
 */
export function loadConfig(): AppConfig {
  const port = parseInt(process.env.PORT || '3001', 10)
  const dbPath = process.env.DB_PATH || '.data/review.db'

  const apiKey = process.env.LLM_API_KEY || ''
  if (!apiKey) {
    console.error('[config] 错误：LLM_API_KEY 未配置，请在 .env 文件中设置')
    process.exit(1)
  }

  const provider = process.env.LLM_PROVIDER || 'openai'
  const defaultBaseUrls: Record<string, string> = {
    openai: 'https://api.openai.com',
    anthropic: 'https://api.anthropic.com',
    deepseek: 'https://api.deepseek.com',
    moonshot: 'https://api.moonshot.cn',
    zhipu: 'https://open.bigmodel.cn/api/paas/v4'
  }

  return {
    port,
    dbPath,
    llm: {
      apiKey,
      baseUrl: process.env.LLM_BASE_URL || defaultBaseUrls[provider] || 'https://api.openai.com',
      model: process.env.LLM_MODEL || 'deepseek-chat',
      provider,
      maxRetries: parseInt(process.env.LLM_MAX_RETRIES || '3', 10)
    },
    maxConcurrentTasks: parseInt(process.env.MAX_CONCURRENT_TASKS || '3', 10)
  }
}
