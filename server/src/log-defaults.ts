/**
 * 日志默认值的唯一实现：config.ts（校验后的配置）与 logger.ts（引导阶段，config 尚未加载）共用。
 * 本模块不依赖任何其他模块，避免 config ↔ logger 循环依赖。
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
export type LogFormat = 'json' | 'pretty'

const LEVELS: readonly LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR']

/**
 * 根据 NODE_ENV / LOG_LEVEL / LOG_FORMAT 原始值计算日志等级与格式。
 * 非法或缺省值回退到环境默认：生产 INFO + json，其余 DEBUG + pretty。
 */
export function resolveLogSettings(raw: { nodeEnv?: string; level?: string; format?: string }): {
  level: LogLevel
  format: LogFormat
} {
  const isProd = raw.nodeEnv === 'production'
  const level = raw.level?.trim().toUpperCase() as LogLevel | undefined
  const format = raw.format?.trim().toLowerCase()
  return {
    level: level && LEVELS.includes(level) ? level : isProd ? 'INFO' : 'DEBUG',
    format: format === 'json' || format === 'pretty' ? format : isProd ? 'json' : 'pretty'
  }
}
