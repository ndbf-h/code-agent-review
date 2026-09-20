import type { Channel, ConsumeMessage } from 'amqplib'
import { createHash } from 'node:crypto'
import type { AppConfig } from '../config'
import { RabbitSession, TASK_READY_QUEUE } from './rabbit'
import type { TaskProducer } from './producer'
import { createTaskEventSink } from './event-sink'
import {
  claimTaskForRun,
  completeTask,
  getTask,
  scheduleTaskRetry,
  markTaskFailed,
  resetTaskArtifacts,
  touchTaskHeartbeat,
  updateTaskStatus,
  insertTaskMetric,
  getReviewCache,
  saveReviewCache,
  bumpReviewCacheHit
} from '../db/queries'
import { saveReport } from '../services/taskService'
import { runReviewTask } from '../agent/orchestrator'
import { llmClient } from '../agent/llm-client'
import { appendTaskEvent } from '../services/eventService'
import { withTaskTrace } from '../observability/tracing'
import { createLogger } from '../logger'
import { commentReportToPullRequest } from '../integrations/github/webhook'
import type { ReportContent, ReviewConfig } from '../../../shared/types'

const logger = createLogger('worker')

/**
 * 缓存键组成部分：代码 + 语言 + 模型 + prompt 版本。
 * prompt 大改时手动递增 PROMPT_VERSION，旧缓存自然失效（键不匹配）。
 */
const PROMPT_VERSION = 'v1'

/** 审查配置的稳定序列化：字段与数组顺序归一，保证相同配置产出相同键（REQ-14） */
export function serializeReviewConfig(config: ReviewConfig): string {
  const parts: string[] = []
  if (config.instructions) parts.push(`instructions=${config.instructions}`)
  if (config.dimensions?.length) parts.push(`dimensions=${[...config.dimensions].sort().join(',')}`)
  if (config.severityThreshold) parts.push(`severityThreshold=${config.severityThreshold}`)
  if (config.maxIssues !== undefined) parts.push(`maxIssues=${config.maxIssues}`)
  return parts.join(';')
}

/** 缓存键（REQ-14）：审查配置不同即视为不同请求，避免复用不符合配置的历史报告 */
export function buildReviewCacheKey(
  code: string,
  language: string,
  model: string,
  reviewConfig?: ReviewConfig
): string {
  const configPart = reviewConfig ? serializeReviewConfig(reviewConfig) : ''
  return createHash('sha256')
    .update(`${code}\n--\n${language}\n--\n${model}\n--\n${PROMPT_VERSION}\n--\n${configPart}`)
    .digest('hex')
}

export interface TaskConsumer {
  /** 取消消费并等待在途任务结束（带超时）；超时后关闭连接，未 ack 消息由 broker 重投 */
  stop(timeoutMs: number): Promise<void>
}

type RunOutcome = 'completed' | 'retried' | 'failed' | 'cancelled'

/**
 * 失败后是否还有重试额度（纯函数，便于单测）。
 * failedAttempts 含刚刚失败的这一次；maxAttempts 含首次执行（=2 表示首次 + 1 次重试）。
 */
export function decideRetry(failedAttempts: number, maxAttempts: number): boolean {
  return failedAttempts < maxAttempts
}

/**
 * 启动任务消费者。并发控制完全由 prefetch 实现：
 * channel 上未 ack 的消息数不超过 maxConcurrentTasks，broker 据此推送——
 * 多个 worker 实例共享队列时天然分摊，不再依赖任何进程内计数器。
 */
export function startTaskConsumer(
  session: RabbitSession,
  producer: TaskProducer,
  config: AppConfig
): TaskConsumer {
  const inFlight = new Set<Promise<void>>()
  let consumerTag: string | null = null
  let channel: Channel | null = null

  // RabbitSession 重连后会重新回调，重建 channel 与消费者
  session.onReady(async connection => {
    const ch = await connection.createChannel()
    ch.prefetch(config.maxConcurrentTasks)
    channel = ch
    const { consumerTag: tag } = await ch.consume(TASK_READY_QUEUE, message => {
      void handleMessage(ch, message)
    })
    consumerTag = tag
    logger.info(`开始消费 ${TASK_READY_QUEUE}`, { prefetch: config.maxConcurrentTasks })
  })

  async function handleMessage(ch: Channel, message: ConsumeMessage | null): Promise<void> {
    if (!message) {
      // broker 主动取消消费（如队列被删除），重连机制会恢复
      logger.error('消费被 broker 取消')
      return
    }

    let taskId: string | undefined
    try {
      taskId = (JSON.parse(message.content.toString()) as { taskId?: string }).taskId
    } catch {
      logger.error('消息体无法解析，已丢弃', { body: message.content.toString().slice(0, 500) })
      ch.ack(message)
      return
    }
    if (!taskId) {
      ch.ack(message)
      return
    }

    let claim: Awaited<ReturnType<typeof claimTaskForRun>>
    try {
      claim = await claimTaskForRun(taskId)
    } catch (error) {
      // DB 不可用：nack 重回队列，等 broker 重新投递
      logger.error('抢占任务失败（DB 异常），消息重回队列', { taskId, error })
      ch.nack(message, false, true)
      return
    }
    if (!claim.claimed) {
      // running：其他 worker 正在执行（崩溃回收交给 sweeper）；terminal：重复投递，幂等吸收
      ch.ack(message)
      return
    }

    const promise = (async () => {
      try {
        const outcome = await runClaimedTask(taskId, producer, config)
        if (outcome === 'failed') logger.warn('任务最终失败（已归档 DLQ）', { taskId })
        else if (outcome === 'retried') logger.warn('任务失败，已转入延迟重试队列', { taskId })
      } catch (error) {
        // runClaimedTask 内部已处理业务失败；这里是记账类异常，任务状态已非 pending，
        // ack 当前消息由 sweeper 心跳超时兜底回收，避免消息无限重投
        logger.error('任务处理过程发生意外异常', { taskId, error })
      }
      try {
        ch.ack(message)
      } catch {
        // 通道已断：broker 会重投该消息，claim 幂等会吸收
      }
    })()
    inFlight.add(promise)
    void promise.finally(() => inFlight.delete(promise))
  }

  return {
    async stop(timeoutMs: number): Promise<void> {
      if (channel && consumerTag) {
        try {
          await channel.cancel(consumerTag)
        } catch {
          /* 通道可能已随连接断开 */
        }
      }
      const deadline = Date.now() + timeoutMs
      while (inFlight.size > 0 && Date.now() < deadline) {
        await Promise.race([Promise.allSettled(inFlight), sleepUntil(deadline)])
      }
      if (inFlight.size > 0) {
        logger.warn('优雅关闭超时，仍有任务在途，交由 broker 重投恢复', {
          inFlight: inFlight.size
        })
      }
    }
  }
}

function sleepUntil(deadline: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, deadline - Date.now())))
}

/**
 * 执行已被抢占的任务。
 * 失败路径：额度未耗尽 → 回 pending + 发延迟重试；耗尽 → 标记 failed + error 事件 + DLQ 归档。
 * orchestrator 正常结束时自己会发 report_ready / task_completed 事件（经 sink 落库），
 * 失败时不会发终态事件，由这里补 error。
 */
async function runClaimedTask(
  taskId: string,
  producer: TaskProducer,
  config: AppConfig
): Promise<RunOutcome> {
  const task = await getTask(taskId)
  if (!task) {
    await markTaskFailed(taskId)
    return 'failed'
  }

  // ── 语义缓存：同代码+语言+模型+prompt 版本直接复用报告（零 LLM 成本，秒级完成）──
  const cacheKey = buildReviewCacheKey(
    task.codeSnippet,
    task.language,
    llmClient.modelName,
    task.reviewConfig
  )
  let cached: Awaited<ReturnType<typeof getReviewCache>> = null
  try {
    cached = await getReviewCache(cacheKey)
  } catch (cacheError) {
    logger.warn('缓存查询失败（忽略，走正常执行）', { taskId, error: cacheError })
  }
  if (cached) {
    const startedAt = Date.now()
    try {
      const reportContent = JSON.parse(cached.reportContent) as ReportContent
      await saveReport(taskId, reportContent, cached.score)
      // REQ-15：来源为 GitHub PR 的任务，缓存命中同样回写评论
      await commentReportToPullRequest(task, reportContent)
      await appendTaskEvent(taskId, {
        type: 'agent_thought',
        message: '命中审查结果缓存，直接复用历史报告（相同代码/语言/模型）'
      })
      await appendTaskEvent(taskId, { type: 'report_ready', report: reportContent })
      await appendTaskEvent(taskId, { type: 'task_completed' })
      await updateTaskStatus(taskId, 'completed')
      await bumpReviewCacheHit(cacheKey)
      await insertTaskMetric({
        taskId,
        attempt: (task.attemptCount ?? 0) + 1,
        status: 'completed',
        model: cached.model,
        promptTokens: 0,
        completionTokens: 0,
        fallbackReviewers: 0,
        durationMs: Date.now() - startedAt,
        cacheHit: true
      })
      logger.info('任务命中缓存，零成本完成', { taskId, cacheKey: cacheKey.slice(0, 12) })
      return 'completed'
    } catch (error) {
      // 缓存数据损坏时退回正常执行
      logger.warn('缓存命中但回放失败（忽略，走正常执行）', { taskId, error })
    }
  }

  const priorAttempts = task.attemptCount ?? 0
  if (priorAttempts > 0) {
    await resetTaskArtifacts(taskId)
    await appendTaskEvent(taskId, {
      type: 'task_retrying',
      message: `正在重试（第 ${priorAttempts + 1} 次尝试）...`
    })
  }

  const sink = createTaskEventSink(taskId)
  // 心跳独立于 LLM 进度（长调用期间也持续上报），sweeper 以此判定 worker 存活
  const heartbeatTimer = setInterval(() => {
    void touchTaskHeartbeat(taskId).catch(() => undefined)
  }, config.heartbeat.intervalMs)
  heartbeatTimer.unref?.()

  // 取消支持：轮询 DB 状态（API 的 cancelTask 原子置 cancelled），命中即中止在途 LLM 请求
  const taskStartedAt = Date.now()
  const abortController = new AbortController()
  const cancelPoller = setInterval(() => {
    void (async () => {
      try {
        const current = await getTask(taskId)
        if (current?.status === 'cancelled' && !abortController.signal.aborted) {
          logger.info('任务收到取消指令，中止执行', { taskId })
          abortController.abort()
        }
      } catch {
        // 轮询失败忽略，下个周期再试
      }
    })()
  }, 3000)
  cancelPoller.unref?.()

  let runOutcome: RunOutcome = 'failed'
  let runError: string | undefined
  let usage = { promptTokens: 0, completionTokens: 0, llmCalls: 0, durationMs: 0 }
  let fallbackReviewers = 0

  try {
    // 全链路追踪上下文贯穿 runReviewTask → reviewer → llm-client，同时精确累计该任务的 token 用量
    const traced = await withTaskTrace({ taskId, attempt: priorAttempts + 1 }, async () => {
      const reportContent = await runReviewTask(
        taskId,
        task.codeSnippet,
        task.language,
        event => sink.push(event),
        task.scopeId,
        abortController.signal,
        task.reviewConfig
      )
      const results = Object.values(reportContent.agentResults || {})
      const score =
        results.length > 0
          ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
          : 0
      await saveReport(taskId, reportContent, score)
      // REQ-15：来源为 GitHub PR 的任务，完成后回写 Markdown 报告评论
      await commentReportToPullRequest(task, reportContent)
      return reportContent
    })
    usage = traced.usage
    fallbackReviewers = Object.values(traced.result.reviewStatus || {}).filter(
      s => s === 'fallback'
    ).length
    // 先把事件全部落库（含终态事件），再翻转 DB 状态，保证 SSE 回放/快照不超前于事件流
    await sink.flush()
    // 条件写入：若任务在收尾瞬间被取消，completeTask 抢不到则按取消结算（不覆盖用户意图）
    const completed = await completeTask(taskId)
    if (!completed) {
      runOutcome = 'cancelled'
      logger.info('任务完成时发现已被取消，报告保留但不改变取消状态', { taskId })
      return 'cancelled'
    }
    runOutcome = 'completed'
    // 成功结果写入语义缓存（失败结果不入缓存；模型/prompt 版本变化时键自然失效）
    await saveReviewCache({
      codeHash: cacheKey,
      reportContent: JSON.stringify(traced.result),
      score: traced.result.score,
      model: llmClient.modelName,
      promptVersion: PROMPT_VERSION
    }).catch(cacheError => {
      logger.warn('结果写入缓存失败（不影响任务）', { taskId, error: cacheError })
    })
  } catch (error) {
    runError = error instanceof Error ? error.message : 'Unknown error'
    await sink.flush()
    // 用户取消：状态已由 cancelTask 原子置为 cancelled，worker 不重试/不入 DLQ/不写缓存
    if (abortController.signal.aborted) {
      runOutcome = 'cancelled'
      usage.durationMs = Date.now() - taskStartedAt
    }
    const failedAttempts = priorAttempts + 1
    if (runOutcome === 'cancelled') {
      await appendTaskEvent(taskId, {
        type: 'agent_thought',
        message: '已终止在途的模型调用，任务资源已释放'
      })
    } else if (decideRetry(failedAttempts, config.taskRetry.maxAttempts)) {
      await scheduleTaskRetry(taskId)
      await appendTaskEvent(taskId, {
        type: 'task_retrying',
        message: `尝试失败：${runError}。${Math.round(config.taskRetry.delayMs / 1000)}s 后自动重试`
      })
      await producer.sendToRetry(taskId)
      runOutcome = 'retried'
    } else {
      await markTaskFailed(taskId)
      await appendTaskEvent(taskId, {
        type: 'error',
        message: `审查任务失败（共尝试 ${failedAttempts} 次）: ${runError}`
      })
      try {
        await producer.sendToDead(taskId, runError)
      } catch (dlqError) {
        logger.error('任务写入 DLQ 失败', { taskId, error: dlqError })
      }
      runOutcome = 'failed'
    }
  } finally {
    clearInterval(heartbeatTimer)
    clearInterval(cancelPoller)
    await sink.close()
    // 指标落库：无论成败都记录一行（token 用量来自 ALS 上下文，并发任务互不串扰）
    try {
      await insertTaskMetric({
        taskId,
        attempt: priorAttempts + 1,
        status: runOutcome,
        model: llmClient.modelName,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        fallbackReviewers,
        durationMs: usage.durationMs,
        error: runOutcome === 'completed' ? undefined : runError
      })
    } catch (metricError) {
      logger.error('任务指标落库失败', { taskId, error: metricError })
    }
  }

  return runOutcome
}
