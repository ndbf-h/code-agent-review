import { getConfig } from '../config'
import { getCurrentTaskTokenUsage } from '../observability/tracing'
import { createLogger } from '../logger'

const logger = createLogger('budget')

/**
 * 任务级 token 预算（REQ-11）。
 *
 * 语义：`TASK_TOKEN_BUDGET <= 0` 表示不限制。用量来源是 tracing 的 AsyncLocalStorage
 * 计数器，worker 进程内按任务累计，因此并行 reviewer 共享同一个实例即天然共享剩余额度。
 *
 * 检查点（批次 E）：reviewer 启动前、ReAct 每轮发起 LLM 调用前、结构化输出前。
 * 超限后不再发起新的 LLM 调用，已在途的调用会正常返回，
 * 所以任务总用量上限约为「预算 + 并行 reviewer 数 × 单次调用用量」。
 */
export class TaskBudget {
  private warned = false

  constructor(private readonly limitTokens: number) {}

  /** 配置的预算上限（0 表示不限制） */
  get limit(): number {
    return this.limitTokens
  }

  /** 当前任务已消耗的 token 总量 */
  used(): number {
    return getCurrentTaskTokenUsage().total
  }

  /** 是否已超出预算；未配置预算时恒为 false。首次发现超限时记一条告警 */
  isExceeded(): boolean {
    if (this.limitTokens <= 0) return false
    const used = this.used()
    if (used < this.limitTokens) return false
    if (!this.warned) {
      this.warned = true
      logger.warn('任务 token 预算已耗尽', { limit: this.limitTokens, used })
    }
    return true
  }
}

/** 按配置创建预算对象，默认读取 `TASK_TOKEN_BUDGET` */
export function createTaskBudget(limitTokens = getConfig().agent.taskTokenBudget): TaskBudget {
  return new TaskBudget(limitTokens)
}
