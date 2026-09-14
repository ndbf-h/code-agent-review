/**
 * 结构化日志：pino 实现，保留 createLogger(name) 与 debug/info/warn/error(message, ...args) 签名。
 * - LOG_FORMAT=json：单行 JSON（level、time、name、msg、requestId、其余附加字段）
 * - LOG_FORMAT=pretty：pino-pretty 可读输出（本地开发）
 * - 处于 HTTP 请求上下文时自动附带 requestId（见 middleware/requestContext.ts）
 *
 * 本模块是最底层依赖，不导入 config（避免循环依赖，且 CLI / 单测环境不一定有完整配置）；
 * 默认从环境变量读取，入口 loadConfig() 成功后会调用 configureLogger 应用校验过的值。
 */
import pino, { type Logger as PinoLogger, type LevelWithSilent } from 'pino'
import pretty from 'pino-pretty'
import { getRequestId } from './middleware/requestContext'

/** 日志等级类型 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
export type LogFormat = 'json' | 'pretty'

export interface LogDestination {
  write(chunk: string): void
}

export interface LoggerOptions {
  level?: LogLevel
  format?: LogFormat
  /** 自定义输出（单测捕获用）；缺省为 stdout */
  destination?: LogDestination
}

const LEVEL_MAP: Record<LogLevel, LevelWithSilent> = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error'
}

function envDefaults(): { level: LogLevel; format: LogFormat } {
  const isProd = process.env.NODE_ENV === 'production'
  const rawLevel = process.env.LOG_LEVEL?.trim().toUpperCase()
  const level: LogLevel =
    rawLevel && rawLevel in LEVEL_MAP ? (rawLevel as LogLevel) : isProd ? 'INFO' : 'DEBUG'
  const rawFormat = process.env.LOG_FORMAT?.trim().toLowerCase()
  const format: LogFormat =
    rawFormat === 'json' || rawFormat === 'pretty' ? rawFormat : isProd ? 'json' : 'pretty'
  return { level, format }
}

let root: PinoLogger | null = null
let rootVersion = 0

function buildRoot(options: LoggerOptions): PinoLogger {
  const defaults = envDefaults()
  const level = LEVEL_MAP[options.level ?? defaults.level]
  const format = options.format ?? defaults.format
  const pinoOptions: pino.LoggerOptions = {
    level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: label => ({ level: label })
    },
    mixin() {
      const requestId = getRequestId()
      return requestId ? { requestId } : {}
    },
    serializers: { err: pino.stdSerializers.err }
  }

  if (options.destination) {
    return pino(pinoOptions, options.destination as pino.DestinationStream)
  }
  if (format === 'pretty') {
    return pino(
      pinoOptions,
      pretty({
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname',
        // 同步写出：启动失败等场景 logger.error 后紧接 process.exit，避免丢最后一行
        sync: true
      })
    )
  }
  return pino(pinoOptions)
}

function getRoot(): PinoLogger {
  if (!root) {
    root = buildRoot({})
    rootVersion++
  }
  return root
}

/**
 * 重新配置根日志器（入口加载配置后调用；单测注入 destination）。
 * 已创建的命名 logger 会在下一次输出时自动切换到新根。
 */
export function configureLogger(options: LoggerOptions): void {
  root = buildRoot(options)
  rootVersion++
}

/** 把 (message, ...args) 规整为 pino 的 (bindings, msg) 形式 */
function toBindings(args: unknown[]): Record<string, unknown> {
  const bindings: Record<string, unknown> = {}
  const extras: unknown[] = []
  for (const arg of args) {
    if (arg instanceof Error) {
      if (bindings.err === undefined) bindings.err = arg
      else extras.push(arg)
    } else if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
      for (const [key, value] of Object.entries(arg as Record<string, unknown>)) {
        // 附加对象里携带的 Error 也走 err 序列化（保留 stack）
        if (value instanceof Error && bindings.err === undefined && key === 'error') {
          bindings.err = value
        } else {
          bindings[key] = value
        }
      }
    } else {
      extras.push(arg)
    }
  }
  if (extras.length > 0) bindings.args = extras
  return bindings
}

export interface Logger {
  debug: (message: string, ...args: unknown[]) => void
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
}

/**
 * 创建一个命名日志实例
 * @param name 日志来源名称（通常为模块名或组件名）
 */
export function createLogger(name: string): Logger {
  let child: PinoLogger | null = null
  let childVersion = -1

  function target(): PinoLogger {
    const current = getRoot()
    if (!child || childVersion !== rootVersion) {
      child = current.child({ name })
      childVersion = rootVersion
    }
    return child
  }

  function log(level: 'debug' | 'info' | 'warn' | 'error', message: string, args: unknown[]) {
    const logger = target()
    if (!logger.isLevelEnabled(level)) return
    if (args.length === 0) {
      logger[level](message)
      return
    }
    logger[level](toBindings(args), message)
  }

  return {
    debug: (message, ...args) => log('debug', message, args),
    info: (message, ...args) => log('info', message, args),
    warn: (message, ...args) => log('warn', message, args),
    error: (message, ...args) => log('error', message, args)
  }
}
