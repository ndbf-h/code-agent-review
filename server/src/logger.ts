/** 日志等级类型 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

/** 日志等级对应的数值（用于比较） */
const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
}

/** 获取当前日志等级（从环境变量 LOG_LEVEL 读取，默认 DEBUG） */
function getCurrentLevel(): LogLevel {
  const env = process.env.LOG_LEVEL?.toUpperCase().trim() as LogLevel | undefined
  if (env && env in LOG_LEVEL_RANK) return env
  return 'DEBUG'
}

/**
 * 生成 ISO 格式时间戳（YYYY-MM-DD HH:mm:ss）
 */
function getTimestamp(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

/**
 * 创建一个命名日志实例
 * @param name 日志来源名称（通常为模块名或组件名）
 * @returns 包含 debug / info / warn / error 方法的对象
 */
export function createLogger(name: string) {
  const currentLevel = getCurrentLevel()

  function log(level: LogLevel, message: string, ...args: unknown[]) {
    if (LOG_LEVEL_RANK[level] < LOG_LEVEL_RANK[currentLevel]) return
    const timestamp = getTimestamp()
    const prefix = `${timestamp} [${level}] [${name}]`

    const consoleMethod: 'log' | 'warn' | 'error' =
      level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'

    if (args.length > 0) {
      console[consoleMethod](`${prefix} ${message}`, ...args)
    } else {
      console[consoleMethod](`${prefix} ${message}`)
    }
  }

  return {
    debug: (message: string, ...args: unknown[]) => log('DEBUG', message, ...args),
    info: (message: string, ...args: unknown[]) => log('INFO', message, ...args),
    warn: (message: string, ...args: unknown[]) => log('WARN', message, ...args),
    error: (message: string, ...args: unknown[]) => log('ERROR', message, ...args)
  }
}
