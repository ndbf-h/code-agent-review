import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { createLogger, configureLogger } from '../logger'
import { runWithRequestContext } from '../middleware/requestContext'

/** 收集 pino 输出的每一行 JSON */
function captureDestination() {
  const lines: string[] = []
  return {
    lines,
    write(chunk: string) {
      lines.push(chunk)
    },
    records() {
      return lines
        .join('')
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as Record<string, unknown>)
    }
  }
}

describe('结构化日志（pino）', () => {
  let sink: ReturnType<typeof captureDestination>

  beforeEach(() => {
    sink = captureDestination()
    configureLogger({ level: 'DEBUG', format: 'json', destination: sink })
  })

  afterAll(() => {
    // 恢复默认输出，避免影响其他测试文件的日志
    configureLogger({ level: 'ERROR', format: 'json' })
  })

  it('JSON 模式输出单行可解析记录，包含 level / time / name / msg', () => {
    const logger = createLogger('unit')
    logger.info('hello world')
    const [record] = sink.records()
    expect(record.level).toBe('info')
    expect(typeof record.time).toBe('string')
    expect(record.name).toBe('unit')
    expect(record.msg).toBe('hello world')
    expect(sink.lines.join('').trim().split('\n')).toHaveLength(1)
  })

  it('附加对象展开为结构化字段，Error 走 err 序列化并保留 stack', () => {
    const logger = createLogger('unit')
    logger.warn('failed', { taskId: 't-1', attempt: 2 }, new Error('boom'))
    const [record] = sink.records()
    expect(record.taskId).toBe('t-1')
    expect(record.attempt).toBe(2)
    const err = record.err as { message: string; stack?: string }
    expect(err.message).toBe('boom')
    expect(err.stack).toContain('boom')
  })

  it('附加对象中的 error 字段若为 Error 同样序列化', () => {
    const logger = createLogger('unit')
    logger.error('op failed', { error: new Error('inner') })
    const [record] = sink.records()
    expect((record.err as { message: string }).message).toBe('inner')
  })

  it('等级过滤：配置为 WARN 时 debug / info 不输出', () => {
    configureLogger({ level: 'WARN', format: 'json', destination: sink })
    const logger = createLogger('unit')
    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')
    const levels = sink.records().map(r => r.level)
    expect(levels).toEqual(['warn', 'error'])
  })

  it('处于请求上下文时自动附加 requestId，上下文外不附加', () => {
    const logger = createLogger('unit')
    runWithRequestContext({ requestId: 'req-123' }, () => {
      logger.info('inside')
    })
    logger.info('outside')
    const [inside, outside] = sink.records()
    expect(inside.requestId).toBe('req-123')
    expect(outside.requestId).toBeUndefined()
  })

  it('已创建的 logger 在重新配置后切换到新输出', () => {
    const logger = createLogger('unit')
    logger.info('first')
    const second = captureDestination()
    configureLogger({ level: 'DEBUG', format: 'json', destination: second })
    logger.info('second')
    expect(sink.records().map(r => r.msg)).toEqual(['first'])
    expect(second.records().map(r => r.msg)).toEqual(['second'])
  })
})
