import type { Response } from 'express'

/** SSE 心跳间隔：定时发送注释行，防止代理按空闲超时断开长连接 */
const SSE_HEARTBEAT_INTERVAL_MS = 20_000

/** 启动 SSE 心跳，连接关闭或响应结束时自动清理定时器 */
export function startSseHeartbeat(res: Response): ReturnType<typeof setInterval> {
  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(heartbeat)
      return
    }
    res.write(': ping\n\n')
  }, SSE_HEARTBEAT_INTERVAL_MS)
  res.on('close', () => clearInterval(heartbeat))
  res.on('finish', () => clearInterval(heartbeat))
  return heartbeat
}

/** 终态事件：task_completed / task_cancelled，或无 agentId 的全局 error（带 agentId 的 error 只是单个审查员失败） */
export function isTerminalEvent(event: { type: string; agentId?: string }): boolean {
  return (
    event.type === 'task_completed' ||
    event.type === 'task_cancelled' ||
    (event.type === 'error' && !event.agentId)
  )
}

/** 写一帧 SSE 事件；seq 存在时先写 id 行，供浏览器 EventSource 断线续传 */
export function writeSseEvent(res: Response, event: string, data: unknown, seq?: number): void {
  if (res.writableEnded || res.destroyed) return
  if (seq !== undefined) res.write(`id: ${seq}\n`)
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

/** 建立流式响应的公共响应头（SSE 语义，禁用代理缓冲） */
export function writeSseHeaders(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
}
