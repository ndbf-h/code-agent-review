import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { createLogger } from '../logger'

const logger = createLogger('tracing')

/**
 * 全链路追踪（task → reviewer → LLM generation），经 Langfuse 官方 HTTP Ingestion API 直写。
 *
 * 设计约束：
 * 1. AsyncLocalStorage 贯穿调用链，orchestrator/llm-client 零签名侵入；
 *    Promise.allSettled 并行的 reviewer 各自 fork 上下文，互不串扰。
 * 2. token 计数是指标落库（task_metrics）的数据源，与 Langfuse 是否启用无关——
 *    未配置 LANGFUSE_* 密钥时退化为纯内存计数，全部功能照常。
 * 3. 上报为批量缓冲（3s 或 50 条触发），失败仅告警不影响业务；shutdown 时强制 flush。
 *    （不使用 langfuse SDK：v3 已 OTel 化，遗留命令式 API 的 ingestion 不再可靠。）
 */

interface IngestionEvent {
  id: string
  type: 'trace-create' | 'span-create' | 'span-update' | 'generation-create'
  timestamp: string
  body: Record<string, unknown>
}

interface TaskTraceContext {
  taskId: string
  attempt: number
  /** 引用类型：并行的 reviewer fork 出的 context 副本共享同一份计数器 */
  usage: { promptTokens: number; completionTokens: number; llmCalls: number }
  startedAt: number
  reviewerSpan?: { spanId: string }
}

const storage = new AsyncLocalStorage<TaskTraceContext>()

class LangfuseIngestClient {
  private queue: IngestionEvent[] = []
  private timer: NodeJS.Timeout | null = null
  private stopping = false

  constructor(
    private readonly publicKey: string,
    private readonly secretKey: string,
    private readonly baseUrl: string
  ) {
    const flusher = setInterval(() => this.flush(), 3000)
    flusher.unref?.()
  }

  push(
    event: Omit<IngestionEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: string }
  ): void {
    if (this.stopping) return
    this.queue.push({
      id: event.id || randomUUID(),
      type: event.type,
      timestamp: event.timestamp || new Date().toISOString(),
      body: event.body
    })
    if (this.queue.length >= 50) this.flush()
  }

  flush(): void {
    if (this.queue.length === 0) return
    const batch = this.queue.splice(0, 100)
    const auth = Buffer.from(`${this.publicKey}:${this.secretKey}`).toString('base64')
    fetch(`${this.baseUrl}/api/public/ingestion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      // v3 ingestion 契约：{batch: [event...]}
      body: JSON.stringify({ batch })
    })
      .then(async response => {
        if (!response.ok) {
          logger.warn('ingestion 请求被拒', {
            status: response.status,
            body: (await response.text()).slice(0, 200)
          })
          return
        }
        // v3 批量接口整体 200/207 时也可能有单条失败，需检查 errors 数组
        try {
          const result = JSON.parse(await response.text()) as {
            successes?: unknown[]
            errors?: Array<{ id: string; message: string }>
          }
          const ok = result.successes?.length ?? 0
          if (result.errors && result.errors.length > 0) {
            logger.warn('ingestion 批次部分被拒', {
              batch: batch.length,
              ok,
              rejected: result.errors.length,
              errors: JSON.stringify(result.errors).slice(0, 300)
            })
          } else {
            logger.debug('ingestion 批次全部成功', { batch: batch.length })
          }
        } catch {
          // 非 JSON 响应忽略
        }
      })
      .catch(error => {
        logger.warn('ingestion 网络失败', { error })
      })
  }

  async shutdown(): Promise<void> {
    this.stopping = true
    if (this.timer) clearInterval(this.timer)
    this.flush()
    // 留给在途请求完成
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

let ingestClient: LangfuseIngestClient | null = null

/** 启动时调用：配置了密钥则启用上报，否则纯内存模式 */
export function initTracing(options?: {
  publicKey?: string
  secretKey?: string
  baseUrl?: string
}): void {
  const publicKey = options?.publicKey || process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = options?.secretKey || process.env.LANGFUSE_SECRET_KEY
  if (!publicKey || !secretKey) {
    logger.info('Langfuse 未配置密钥，运行在纯计数模式（指标落库不受影响）')
    return
  }
  const baseUrl = (
    options?.baseUrl ||
    process.env.LANGFUSE_BASE_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '')
  ingestClient = new LangfuseIngestClient(publicKey, secretKey, baseUrl)
  logger.info('Langfuse 已启用', { baseUrl })
}

export async function shutdownTracing(): Promise<void> {
  if (ingestClient) await ingestClient.shutdown()
}

export interface TaskUsage {
  promptTokens: number
  completionTokens: number
  llmCalls: number
  durationMs: number
}

/** 任务级 trace：consumer 消费到任务时进入，结束时返回该任务的 token 用量快照 */
export async function withTaskTrace<T>(
  attrs: { taskId: string; attempt: number },
  fn: (context: TaskTraceContext) => Promise<T>
): Promise<{ result: T; usage: TaskUsage }> {
  const context: TaskTraceContext = {
    taskId: attrs.taskId,
    attempt: attrs.attempt,
    usage: { promptTokens: 0, completionTokens: 0, llmCalls: 0 },
    startedAt: Date.now()
  }
  const startedAt = new Date(context.startedAt).toISOString()
  ingestClient?.push({
    type: 'trace-create',
    timestamp: startedAt,
    body: { id: attrs.taskId, name: 'review-task', metadata: { attempt: attrs.attempt } }
  })
  const result = await storage.run(context, () => fn(context))
  // v3 ingestion 无 trace-update 类型：同 id trace-create 附 endTime 即为更新
  ingestClient?.push({
    type: 'trace-create',
    timestamp: new Date().toISOString(),
    body: { id: attrs.taskId, name: 'review-task', endTime: new Date().toISOString() }
  })
  return {
    result,
    usage: {
      promptTokens: context.usage.promptTokens,
      completionTokens: context.usage.completionTokens,
      llmCalls: context.usage.llmCalls,
      durationMs: Date.now() - context.startedAt
    }
  }
}

/** reviewer 级 span：fork 出共享计数器的上下文副本，并行的 reviewer 互不覆盖标记 */
export async function withReviewerSpan<T>(role: string, fn: () => Promise<T>): Promise<T> {
  const context = storage.getStore()
  if (!context) return fn()
  const spanId = `${context.taskId}-${role}`
  const fork: TaskTraceContext = { ...context, reviewerSpan: { spanId } }
  ingestClient?.push({
    type: 'span-create',
    body: {
      id: spanId,
      traceId: context.taskId,
      name: `reviewer:${role}`,
      startTime: new Date().toISOString(),
      level: 'DEFAULT',
      metadata: { role }
    }
  })
  try {
    return await storage.run(fork, () => fn())
  } finally {
    ingestClient?.push({
      type: 'span-update',
      body: { id: spanId, traceId: context.taskId, endTime: new Date().toISOString() }
    })
  }
}

/**
 * 读取当前任务上下文已累计的 token 用量（REQ-11 预算判断的数据源）。
 * 不在任务上下文内（例如单测直接调用）时返回全 0。
 */
export function getCurrentTaskTokenUsage(): {
  promptTokens: number
  completionTokens: number
  total: number
} {
  const context = storage.getStore()
  if (!context) return { promptTokens: 0, completionTokens: 0, total: 0 }
  const { promptTokens, completionTokens } = context.usage
  return { promptTokens, completionTokens, total: promptTokens + completionTokens }
}

/**
 * LLM 调用记账：llm-client 解析出 usage 时调用。
 * 计数始终累加（供 task_metrics）；启用上报时同时发 generation 事件。
 */
export function recordLlmUsage(usage: {
  model: string
  promptTokens: number
  completionTokens: number
}): void {
  const context = storage.getStore()
  if (!context) return
  context.usage.promptTokens += usage.promptTokens
  context.usage.completionTokens += usage.completionTokens
  context.usage.llmCalls += 1
  ingestClient?.push({
    type: 'generation-create',
    body: {
      id: randomUUID(),
      traceId: context.taskId,
      parentObservationId: context.reviewerSpan?.spanId,
      name: 'llm-call',
      model: usage.model,
      level: 'DEFAULT',
      usage: {
        // v3 ingestion 契约：{input, output, total, unit}（v2 的 promptTokens 命名已废弃）
        input: usage.promptTokens,
        output: usage.completionTokens,
        total: usage.promptTokens + usage.completionTokens,
        unit: 'TOKENS'
      },
      metadata: {
        reviewer: context.reviewerSpan
          ? context.reviewerSpan.spanId.split('-').pop()
          : 'orchestrator'
      }
    }
  })
}
