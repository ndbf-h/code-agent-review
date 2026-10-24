/** 应用错误基类，所有业务错误由此派生 */
export class AppError extends Error {
  public readonly code: string
  public readonly statusCode: number
  public readonly details?: unknown

  constructor(message: string, code: string, statusCode = 500, details?: unknown) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.statusCode = statusCode
    this.details = details
    // 确保 instanceof 检查正常工作
    Object.setPrototypeOf(this, new.target.prototype)
  }

  /** 序列化为 API 响应格式 */
  toJSON(): { error: string; code: string; details?: unknown } {
    const result: { error: string; code: string; details?: unknown } = {
      error: this.message,
      code: this.code
    }
    if (this.details !== undefined) {
      result.details = this.details
    }
    return result
  }
}

/** LLM 调用相关错误 */
export class LlmError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'LLM_ERROR', 502, details)
  }
}

/** 工具执行相关错误 */
export class ToolError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'TOOL_ERROR', 500, details)
  }
}

/** 任务相关错误 */
export class TaskError extends AppError {
  constructor(message: string, code = 'TASK_ERROR', statusCode = 400) {
    super(message, code, statusCode)
  }
}

/** 消息队列不可用：任务已落库但未能入队（已标记失败） */
export class QueueUnavailableError extends AppError {
  constructor(message = '消息队列暂不可用，请稍后重试') {
    super(message, 'QUEUE_UNAVAILABLE', 502)
  }
}

/** 外部来源的重复投递：同一去重键已有任务，本次未创建 */
export class DuplicateTaskError extends AppError {
  constructor(public readonly dedupeKey: string) {
    super('相同来源的审查任务已存在', 'DUPLICATE_TASK', 409)
  }
}

/** 输入验证错误 */
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details)
  }
}
