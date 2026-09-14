import { getConfig } from '../config'
import { getCurrentTaskTokenUsage } from '../observability/tracing'
import { createLogger } from '../logger'

const logger = createLogger('budget')

/**
 * 任务级 token 预算（REQ-11）。
 *
 * 语义：`TASK_TOKEN_BUDGET <= 0` 表示不限制；超限后 orchestrator 不再为后续
 * reviewer 发起 LLM 调用，直接改用规则引擎，把单个任务的成本控制在可预期范围内。
 * 用量来源是 tracing 的 AsyncLocalStorage 计数器，worker 进程内按任务累计。
 */
export class TaskBudget {
  constructor(private readonly limitTokens: number) {}

  /** 配置的预算上限（0 表示不限制） */
  get limit(): number {
    return this.limitTokens
  }

  /** 当前任务已消耗的 token 总量 */
  used(): number {
    return getCurrentTaskTokenUsage().total
  }

  /** 是否已超出预算；未配置预算时恒为 false */
  isExceeded(): boolean {
    if (this.limitTokens <= 0) return false
    const used = this.used()
    if (used < this.limitTokens) return false
    logger.warn('任务 token 预算已耗尽', { limit: this.limitTokens, used })
    return true
  }
}

/** 按配置创建预算对象，默认读取 `TASK_TOKEN_BUDGET` */
export function createTaskBudget(limitTokens = getConfig().agent.taskTokenBudget): TaskBudget {
  return new TaskBudget(limitTokens)
}
