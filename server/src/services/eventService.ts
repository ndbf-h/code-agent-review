import { Client } from 'pg'
import { getConfig } from '../config'
import { insertTaskEvent, getTaskEventBySeq, type TaskEventRow } from '../db/queries'
import type { ReviewEvent } from '../agent/orchestrator'
import { createLogger } from '../logger'

const logger = createLogger('event-subscriber')

/** 带库内自增序号的事件：seq 用于 SSE 断线续传（Last-Event-Id / ?after=）与客户端去重 */
export interface StoredTaskEvent extends ReviewEvent {
  seq: number
}

type TaskEventListener = (event: StoredTaskEvent) => void

const taskEventListeners = new Map<string, Set<TaskEventListener>>()

/** 订阅某任务的实时事件（本进程内），返回取消函数 */
export function subscribeTaskEvents(taskId: string, listener: TaskEventListener): () => void {
  const listeners = taskEventListeners.get(taskId) || new Set<TaskEventListener>()
  listeners.add(listener)
  taskEventListeners.set(taskId, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) taskEventListeners.delete(taskId)
  }
}

function dispatchLocal(taskId: string, event: StoredTaskEvent): void {
  for (const listener of taskEventListeners.get(taskId) || []) {
    try {
      listener(event)
    } catch {
      // 单个 SSE 连接的写异常不应影响其他订阅者
    }
  }
}

/**
 * 事件落库入口。INSERT 触发 task_events 上的触发器 pg_notify，
 * 所有 LISTEN 的 API 实例收到通知后取回事件行并扇出给本进程 SSE 连接。
 * worker 与 API 可能不在同一进程，因此实时扇出完全依赖 PG 通知而非进程内直调。
 */
export async function appendTaskEvent(taskId: string, event: ReviewEvent): Promise<number> {
  return insertTaskEvent(taskId, event.type, event as unknown as Record<string, unknown>)
}

function toStoredEvent(row: TaskEventRow): StoredTaskEvent {
  return { ...(row.payload as unknown as ReviewEvent), type: row.type, seq: row.seq }
}

// ── LISTEN/NOTIFY 订阅（独立于连接池的专用 Client）──

const RECONNECT_DELAY_MS = 3000

let subscriberClient: Client | null = null
let subscriberStopping = false
let reconnectTimer: NodeJS.Timeout | null = null

async function listenLoop(dsn: string): Promise<void> {
  if (subscriberStopping) return
  const client = new Client({ connectionString: dsn })
  subscriberClient = client
  try {
    await client.connect()
    client.on('notification', msg => {
      if (!msg.payload) return
      try {
        const { seq } = JSON.parse(msg.payload) as { taskId: string; seq: number }
        void getTaskEventBySeq(seq)
          .then(row => {
            if (row) dispatchLocal(row.taskId, toStoredEvent(row))
          })
          .catch(() => undefined)
      } catch {
        // 非法 payload 忽略
      }
    })
    client.on('error', err => {
      logger.error('连接异常', { error: err })
      scheduleReconnect(dsn)
    })
    await client.query('LISTEN task_events')
    logger.info('已订阅 task_events 通知通道')
  } catch (error) {
    logger.error('连接失败', { error })
    scheduleReconnect(dsn)
  }
}

function scheduleReconnect(dsn: string): void {
  if (subscriberStopping || reconnectTimer) return
  try {
    void subscriberClient?.end()
  } catch {
    // 忽略
  }
  subscriberClient = null
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void listenLoop(dsn)
  }, RECONNECT_DELAY_MS)
  reconnectTimer.unref?.()
}

export async function startEventSubscriber(): Promise<void> {
  subscriberStopping = false
  await listenLoop(getConfig().databaseUrl)
}

export async function stopEventSubscriber(): Promise<void> {
  subscriberStopping = true
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (subscriberClient) {
    try {
      await subscriberClient.end()
    } catch {
      // 忽略
    }
    subscriberClient = null
  }
}
