import { describe, it, expect } from 'vitest'
import { parseConfig, ConfigError, parseByteSize } from '../config'

const baseEnv: NodeJS.ProcessEnv = {
  LLM_API_KEY: 'sk-test',
  DATABASE_URL: 'postgres://user:pass@db:5432/review',
  RABBITMQ_URL: 'amqp://guest:guest@mq:5672/'
}

function issuesOf(fn: () => unknown): string[] {
  try {
    fn()
  } catch (error) {
    if (error instanceof ConfigError) return error.issues.map(i => i.field)
    throw error
  }
  throw new Error('expected ConfigError')
}

describe('parseConfig', () => {
  it('最小必填配置即可加载，其余使用默认值', () => {
    const config = parseConfig(baseEnv)
    expect(config.env).toBe('development')
    expect(config.port).toBe(3001)
    expect(config.llm.model).toBe('deepseek-chat')
    expect(config.llm.baseUrl).toBe('https://api.openai.com')
    expect(config.llm.maxRetries).toBe(3)
    expect(config.maxConcurrentTasks).toBe(3)
    expect(config.http.corsOrigins).toBe('*')
    expect(config.http.trustProxy).toBe(false)
    expect(config.http.maxBodySize).toBe('2mb')
    expect(config.http.maxCodeChars).toBe(300_000)
    expect(config.auth.apiKeys).toEqual([])
    expect(config.agent).toEqual({
      taskTokenBudget: 0,
      reactMaxToolCalls: 20,
      reactRepeatThreshold: 2
    })
    expect(config.github.apiBase).toBe('https://api.github.com')
  })

  it('缺失全部必填项时一次性报出所有字段名', () => {
    const fields = issuesOf(() => parseConfig({}))
    expect(fields).toEqual(expect.arrayContaining(['LLM_API_KEY', 'DATABASE_URL', 'RABBITMQ_URL']))
    expect(fields).toHaveLength(3)
  })

  it('不再回退到明文口令默认值：空字符串视为未设置', () => {
    const fields = issuesOf(() => parseConfig({ ...baseEnv, DATABASE_URL: '   ' }))
    expect(fields).toEqual(['DATABASE_URL'])
  })

  it('连接串协议不匹配时报错', () => {
    const fields = issuesOf(() =>
      parseConfig({ ...baseEnv, DATABASE_URL: 'mysql://x', RABBITMQ_URL: 'http://x' })
    )
    expect(fields.sort()).toEqual(['DATABASE_URL', 'RABBITMQ_URL'])
  })

  it('非法数字报错并指出字段', () => {
    const fields = issuesOf(() =>
      parseConfig({ ...baseEnv, LLM_MAX_RETRIES: 'abc', PORT: '0', MAX_CONCURRENT_TASKS: '1.5' })
    )
    expect(fields.sort()).toEqual(['LLM_MAX_RETRIES', 'MAX_CONCURRENT_TASKS', 'PORT'])
  })

  it('ConfigError.format 列出全部字段并给出必填指引', () => {
    try {
      parseConfig({})
      throw new Error('unreachable')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      const text = (error as ConfigError).format()
      expect(text).toContain('LLM_API_KEY')
      expect(text).toContain('DATABASE_URL')
      expect(text).toContain('RABBITMQ_URL')
      expect(text).toContain('.env.example')
    }
  })

  it('开发环境默认 DEBUG + pretty，生产环境默认 INFO + json', () => {
    expect(parseConfig(baseEnv).log).toEqual({ level: 'DEBUG', format: 'pretty' })
    expect(parseConfig({ ...baseEnv, NODE_ENV: 'production' }).log).toEqual({
      level: 'INFO',
      format: 'json'
    })
    expect(parseConfig({ ...baseEnv, NODE_ENV: 'production', LOG_LEVEL: 'warn' }).log).toEqual({
      level: 'WARN',
      format: 'json'
    })
  })

  it('LLM_BASE_URL 按 provider 推导默认值，显式配置优先', () => {
    expect(parseConfig({ ...baseEnv, LLM_PROVIDER: 'deepseek' }).llm.baseUrl).toBe(
      'https://api.deepseek.com'
    )
    expect(
      parseConfig({ ...baseEnv, LLM_PROVIDER: 'deepseek', LLM_BASE_URL: 'https://proxy.local/v1' })
        .llm.baseUrl
    ).toBe('https://proxy.local/v1')
    expect(issuesOf(() => parseConfig({ ...baseEnv, LLM_BASE_URL: 'not-a-url' }))).toEqual([
      'LLM_BASE_URL'
    ])
  })

  it('CORS_ORIGINS / API_KEYS 逗号分隔并去空白', () => {
    const config = parseConfig({
      ...baseEnv,
      CORS_ORIGINS: 'https://a.example, https://b.example ,',
      API_KEYS: ' key-1,key-2,, '
    })
    expect(config.http.corsOrigins).toEqual(['https://a.example', 'https://b.example'])
    expect(config.auth.apiKeys).toEqual(['key-1', 'key-2'])
  })

  it('TRUST_PROXY 支持 true/false/跳数/CIDR', () => {
    expect(parseConfig({ ...baseEnv, TRUST_PROXY: 'true' }).http.trustProxy).toBe(true)
    expect(parseConfig({ ...baseEnv, TRUST_PROXY: 'false' }).http.trustProxy).toBe(false)
    expect(parseConfig({ ...baseEnv, TRUST_PROXY: '1' }).http.trustProxy).toBe(1)
    expect(parseConfig({ ...baseEnv, TRUST_PROXY: '10.0.0.0/8, loopback' }).http.trustProxy).toBe(
      '10.0.0.0/8, loopback'
    )
  })

  it('MAX_BODY_SIZE 必须大于 MAX_CODE_CHARS，格式非法时报错', () => {
    expect(issuesOf(() => parseConfig({ ...baseEnv, MAX_BODY_SIZE: '100kb' }))).toEqual([
      'MAX_BODY_SIZE'
    ])
    expect(issuesOf(() => parseConfig({ ...baseEnv, MAX_BODY_SIZE: 'huge' }))).toEqual([
      'MAX_BODY_SIZE'
    ])
    const config = parseConfig({ ...baseEnv, MAX_BODY_SIZE: '512kb', MAX_CODE_CHARS: '100000' })
    expect(config.http.maxBodyBytes).toBe(512 * 1024)
    expect(config.http.maxCodeChars).toBe(100_000)
  })
})

describe('parseByteSize', () => {
  it('解析常见单位', () => {
    expect(parseByteSize('2mb')).toBe(2 * 1024 * 1024)
    expect(parseByteSize('512KB')).toBe(512 * 1024)
    expect(parseByteSize('1048576')).toBe(1_048_576)
    expect(parseByteSize('1.5mb')).toBe(Math.floor(1.5 * 1024 * 1024))
    expect(parseByteSize('abc')).toBeNull()
  })
})
