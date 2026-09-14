/**
 * 应用配置模块
 * 用 zod schema 描述全部环境变量：一次性校验、集中默认值、类型安全。
 * - loadConfig()：进程入口调用，失败时列出全部错误字段后退出
 * - getConfig()：其他模块读取已加载的单例，替代散落的 process.env 直读
 */
import { z } from 'zod'
import { configureLogger, type LogLevel, type LogFormat } from './logger'

export type NodeEnv = 'development' | 'production' | 'test'
export type { LogLevel, LogFormat }

export interface AppConfig {
  env: NodeEnv
  port: number
  databaseUrl: string
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
  log: {
    level: LogLevel
    format: LogFormat
  }
  http: {
    /** '*' 表示允许任意来源；否则为精确匹配的 Origin 白名单 */
    corsOrigins: '*' | string[]
    /** 直接传给 express 的 trust proxy 设置 */
    trustProxy: boolean | number | string
    /** express.json 的 limit 字符串，如 '2mb' */
    maxBodySize: string
    maxBodyBytes: number
    maxCodeChars: number
  }
  auth: {
    /** 为空表示不鉴权 */
    apiKeys: string[]
  }
  agent: {
    /** 0 表示不限 */
    taskTokenBudget: number
    reactMaxToolCalls: number
    reactRepeatThreshold: number
  }
  github: {
    webhookSecret?: string
    token?: string
    apiBase: string
  }
}

export interface ConfigIssue {
  field: string
  message: string
}

function renderIssues(issues: ConfigIssue[]): string {
  const lines = issues.map(i => `  - ${i.field}: ${i.message}`)
  return [
    '[config] 环境变量配置错误，请检查 .env（可参考 .env.example）：',
    ...lines,
    '[config] 必填项：LLM_API_KEY、DATABASE_URL、RABBITMQ_URL'
  ].join('\n')
}

/**
 * 配置非法：issues 列出全部出错字段。
 * message 本身即带字段列表与指引，库式调用（未先 loadConfig 的 getConfig()）抛出时同样可读。
 */
export class ConfigError extends Error {
  readonly issues: ConfigIssue[]

  constructor(issues: ConfigIssue[]) {
    super(renderIssues(issues))
    this.name = 'ConfigError'
    this.issues = issues
  }

  format(): string {
    return renderIssues(this.issues)
  }
}

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com',
  moonshot: 'https://api.moonshot.cn',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4'
}

/** 解析 '2mb' / '512kb' / '1048576' 为字节数；非法返回 null */
export function parseByteSize(value: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/i.exec(value)
  if (!match) return null
  const num = Number(match[1])
  const unit = (match[2] || 'b').toLowerCase()
  const factor = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[unit] ?? 1
  return Math.floor(num * factor)
}

const intEnv = (fallback: number, min: number) =>
  z
    .preprocess(
      v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v),
      z.number().int(`必须是整数`).min(min, `不能小于 ${min}`)
    )
    .default(fallback)

const httpUrl = z.string().refine(v => /^https?:\/\/\S+$/.test(v), '必须是 http(s) URL')

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: intEnv(3001, 1),
    DATABASE_URL: z
      .string({ error: '必填，PostgreSQL 连接串，如 postgres://user:pass@host:5432/db' })
      .refine(v => /^postgres(ql)?:\/\//.test(v), '必须以 postgres:// 或 postgresql:// 开头'),
    RABBITMQ_URL: z
      .string({ error: '必填，RabbitMQ 连接串，如 amqp://user:pass@host:5672/' })
      .refine(v => /^amqps?:\/\//.test(v), '必须以 amqp:// 或 amqps:// 开头'),

    LLM_API_KEY: z.string({ error: '必填，LLM 服务的 API Key' }).min(1, '不能为空'),
    LLM_PROVIDER: z.string().default('openai'),
    LLM_BASE_URL: httpUrl.optional(),
    LLM_MODEL: z.string().default('deepseek-chat'),
    LLM_MAX_RETRIES: intEnv(3, 0),
    LLM_MAX_CONCURRENCY: intEnv(12, 1),

    MAX_CONCURRENT_TASKS: intEnv(3, 1),
    TASK_RETRY_MAX_ATTEMPTS: intEnv(2, 1),
    TASK_RETRY_DELAY_MS: intEnv(30_000, 0),
    TASK_HEARTBEAT_INTERVAL_MS: intEnv(30_000, 1000),
    TASK_HEARTBEAT_STALE_MS: intEnv(120_000, 1000),

    LOG_LEVEL: z
      .preprocess(
        v => (typeof v === 'string' ? v.trim().toUpperCase() : v),
        z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR'])
      )
      .optional(),
    LOG_FORMAT: z.enum(['json', 'pretty']).optional(),

    CORS_ORIGINS: z.string().default('*'),
    TRUST_PROXY: z.string().default('false'),
    MAX_BODY_SIZE: z
      .string()
      .default('2mb')
      .refine(v => parseByteSize(v) !== null, '格式应为 <数字><单位>，如 2mb、512kb'),
    MAX_CODE_CHARS: intEnv(300_000, 1),

    API_KEYS: z.string().default(''),
    TASK_TOKEN_BUDGET: intEnv(0, 0),
    REACT_MAX_TOOL_CALLS: intEnv(20, 1),
    REACT_REPEAT_THRESHOLD: intEnv(2, 1),

    GITHUB_WEBHOOK_SECRET: z.string().optional(),
    GITHUB_TOKEN: z.string().optional(),
    GITHUB_API_BASE: httpUrl.default('https://api.github.com')
  })
  .superRefine((data, ctx) => {
    const bodyBytes = parseByteSize(data.MAX_BODY_SIZE)
    if (bodyBytes !== null && bodyBytes <= data.MAX_CODE_CHARS) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAX_BODY_SIZE'],
        message: `${data.MAX_BODY_SIZE}（${bodyBytes} 字节）必须大于 MAX_CODE_CHARS=${data.MAX_CODE_CHARS}，否则合法请求会被 413 拒绝`
      })
    }
  })

type ParsedEnv = z.infer<typeof envSchema>

function parseTrustProxy(raw: string): boolean | number | string {
  const value = raw.trim()
  const lower = value.toLowerCase()
  if (lower === 'true') return true
  if (lower === 'false' || lower === '') return false
  if (/^\d+$/.test(value)) return Number(value)
  // CIDR / 逗号分隔列表 / loopback 等预设名，原样交给 express
  return value
}

function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

function toAppConfig(env: ParsedEnv): AppConfig {
  const isProd = env.NODE_ENV === 'production'
  const corsList = env.CORS_ORIGINS.trim() === '*' ? '*' : parseList(env.CORS_ORIGINS)
  return {
    env: env.NODE_ENV,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    rabbitmqUrl: env.RABBITMQ_URL,
    llm: {
      apiKey: env.LLM_API_KEY,
      baseUrl: env.LLM_BASE_URL || DEFAULT_BASE_URLS[env.LLM_PROVIDER] || DEFAULT_BASE_URLS.openai,
      model: env.LLM_MODEL,
      provider: env.LLM_PROVIDER,
      maxRetries: env.LLM_MAX_RETRIES,
      maxConcurrency: env.LLM_MAX_CONCURRENCY
    },
    // worker 侧通过 consumer prefetch 实现并发控制，多 worker 实例下天然共享该上限
    maxConcurrentTasks: env.MAX_CONCURRENT_TASKS,
    taskRetry: {
      maxAttempts: env.TASK_RETRY_MAX_ATTEMPTS,
      delayMs: env.TASK_RETRY_DELAY_MS
    },
    heartbeat: {
      intervalMs: env.TASK_HEARTBEAT_INTERVAL_MS,
      staleMs: env.TASK_HEARTBEAT_STALE_MS
    },
    log: {
      level: env.LOG_LEVEL ?? (isProd ? 'INFO' : 'DEBUG'),
      format: env.LOG_FORMAT ?? (isProd ? 'json' : 'pretty')
    },
    http: {
      corsOrigins: corsList === '*' || corsList.length === 0 ? '*' : corsList,
      trustProxy: parseTrustProxy(env.TRUST_PROXY),
      maxBodySize: env.MAX_BODY_SIZE,
      maxBodyBytes: parseByteSize(env.MAX_BODY_SIZE) ?? 0,
      maxCodeChars: env.MAX_CODE_CHARS
    },
    auth: {
      apiKeys: parseList(env.API_KEYS)
    },
    agent: {
      taskTokenBudget: env.TASK_TOKEN_BUDGET,
      reactMaxToolCalls: env.REACT_MAX_TOOL_CALLS,
      reactRepeatThreshold: env.REACT_REPEAT_THRESHOLD
    },
    github: {
      webhookSecret: env.GITHUB_WEBHOOK_SECRET,
      token: env.GITHUB_TOKEN,
      apiBase: env.GITHUB_API_BASE
    }
  }
}

/** 空字符串视为未设置（.env 里 KEY= 的写法），交给默认值处理 */
function stripEmpty(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.trim() !== '') out[key] = value
  }
  return out
}

/**
 * 纯函数：解析并校验环境变量，失败抛出 ConfigError（包含全部问题字段）。
 * 单测与 getConfig() 使用；不读取全局状态。
 */
export function parseConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(stripEmpty(env))
  if (!result.success) {
    const issues: ConfigIssue[] = result.error.issues.map(issue => ({
      field: issue.path.map(String).join('.') || '(root)',
      message: issue.message
    }))
    throw new ConfigError(issues)
  }
  return toAppConfig(result.data)
}

let loaded: AppConfig | null = null

/**
 * 进程入口调用：从环境变量加载配置并缓存为单例。
 * 校验失败时一次性打印全部错误字段并退出进程。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  try {
    loaded = parseConfig(env)
    // 用校验过的等级 / 格式重建日志器（此前的日志按环境变量默认值输出）
    configureLogger({ level: loaded.log.level, format: loaded.log.format })
    return loaded
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(error.format() + '\n')
      process.exit(1)
    }
    throw error
  }
}

/**
 * 读取已加载的配置单例。入口尚未调用 loadConfig() 时按 process.env 惰性解析，
 * 失败抛出 ConfigError（不退出进程，便于库式调用与单测）。
 * 注意：惰性解析执行的是全量校验——即使调用方只需要 DATABASE_URL，
 * 缺少 LLM_API_KEY 等必填项同样会报错；这是有意为之，保证任何进程形态的配置都完整。
 */
export function getConfig(): AppConfig {
  if (!loaded) loaded = parseConfig(process.env)
  return loaded
}

/** 仅供单测：重置单例 */
export function resetConfigForTests(): void {
  loaded = null
}
