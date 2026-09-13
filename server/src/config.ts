/**
 * 应用配置模块
 * 统一管理所有环境变量配置，包含启动时校验
 */

export interface AppConfig {
  port: number
  rabbitmqUrl: string
  llm: {
    apiKey: string
    baseUrl: string
    model: string
    provider: string
    maxRetries: number
    maxConcurrency: number
  }
  maxConcurrentTasks: number
  taskRetry: {
    maxAttempts: number
    delayMs: number
  }
  heartbeat: {
    intervalMs: number
    staleMs: number
  }
}

function parseIntEnv(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] || '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * 从环境变量加载配置，校验必要字段
 * LLM_API_KEY 缺失时直接退出进程
 */
export function loadConfig(): AppConfig {
  const port = parseIntEnv('PORT', 3001)

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
    rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672/',
    llm: {
      apiKey,
      baseUrl: process.env.LLM_BASE_URL || defaultBaseUrls[provider] || 'https://api.openai.com',
      model: process.env.LLM_MODEL || 'deepseek-chat',
      provider,
      maxRetries: parseIntEnv('LLM_MAX_RETRIES', 3),
      maxConcurrency: parseIntEnv('LLM_MAX_CONCURRENCY', 12)
    },
    // worker 侧通过 consumer prefetch 实现并发控制，多 worker 实例下天然共享该上限
    maxConcurrentTasks: parseIntEnv('MAX_CONCURRENT_TASKS', 3),
    taskRetry: {
      maxAttempts: parseIntEnv('TASK_RETRY_MAX_ATTEMPTS', 2),
      delayMs: parseIntEnv('TASK_RETRY_DELAY_MS', 30_000)
    },
    heartbeat: {
      intervalMs: parseIntEnv('TASK_HEARTBEAT_INTERVAL_MS', 30_000),
      staleMs: parseIntEnv('TASK_HEARTBEAT_STALE_MS', 120_000)
    }
  }
}
