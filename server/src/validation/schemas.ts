/**
 * 所有 HTTP 入参 schema 集中定义（zod）。
 * 与配置相关的上限（MAX_CODE_CHARS）在请求时读取 getConfig()，因此以工厂函数形式提供。
 */
import { z } from 'zod'
import { getConfig } from '../config'

export const TASK_STATUSES = [
  'pending',
  'orchestrating',
  'reviewing',
  'summarizing',
  'completed',
  'failed',
  'cancelled'
] as const

export const REVIEW_DIMENSIONS = ['security', 'performance', 'style', 'logic'] as const
export const SEVERITIES = ['critical', 'warning', 'suggestion'] as const

const uuid = z.uuid('必须是 UUID')

/** 所有 /:id 路径参数 */
export const taskIdParamsSchema = z.object({ id: uuid })
export type TaskIdParams = z.infer<typeof taskIdParamsSchema>

/** 请求级审查配置（REQ-14 落库与执行，本处只负责入参形状） */
export const reviewConfigSchema = z
  .object({
    instructions: z.string().trim().max(2000, '不超过 2000 字符').optional(),
    dimensions: z.array(z.enum(REVIEW_DIMENSIONS)).min(1, '至少选择一个维度').optional(),
    severityThreshold: z.enum(SEVERITIES).optional(),
    maxIssues: z.number().int().min(1).max(200).optional()
  })
  .strict()
export type ReviewConfigInput = z.infer<typeof reviewConfigSchema>

const language = z.string().trim().min(1, '不能为空').max(40, '不超过 40 字符')

function codeField() {
  const max = getConfig().http.maxCodeChars
  return z.string().min(1, '不能为空').max(max, `不超过 ${max} 字符（MAX_CODE_CHARS）`)
}

/** POST /api/tasks */
export function createTaskBodySchema() {
  return z.object({
    code: codeField(),
    language,
    title: z.string().trim().max(200, '不超过 200 字符').optional(),
    scopeId: z.string().trim().min(1).max(200).optional(),
    sourceVersionId: uuid.optional(),
    reviewConfig: reviewConfigSchema.optional()
  })
}
export type CreateTaskBody = z.infer<ReturnType<typeof createTaskBodySchema>>

/** GET /api/tasks */
export const listTasksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(TASK_STATUSES).optional()
})
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>

/** POST /api/tasks/:id/chat/stream */
export const chatBodySchema = z.object({
  message: z.string().trim().min(1, '不能为空').max(8000, '不超过 8000 字符')
})
export type ChatBody = z.infer<typeof chatBodySchema>

/** POST /api/tasks/:id/versions */
export function versionBodySchema() {
  return z.object({
    code: codeField(),
    language,
    summary: z.string().trim().max(2000).optional()
  })
}
export type VersionBody = z.infer<ReturnType<typeof versionBodySchema>>

/** POST /api/tasks/:id/guidelines */
export function guidelineBodySchema() {
  return z.object({
    fileName: z.string().trim().min(1, '不能为空').max(255, '不超过 255 字符'),
    content: codeField(),
    language: z.string().trim().max(40).optional(),
    dimension: z.string().trim().max(40).optional()
  })
}
export type GuidelineBody = z.infer<ReturnType<typeof guidelineBodySchema>>

/** POST /api/tasks/:id/fix：code / language 均可选，缺省回退到任务快照 */
export function fixBodySchema() {
  return z.object({
    code: codeField().optional(),
    language: language.optional()
  })
}
export type FixBody = z.infer<ReturnType<typeof fixBodySchema>>

/** POST /api/tasks/fetch-url */
export const fetchUrlBodySchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, '不能为空')
    .max(2048, '不超过 2048 字符')
    .refine(value => {
      try {
        const parsed = new URL(value)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      } catch {
        return false
      }
    }, '必须是合法的 http/https 链接')
})
export type FetchUrlBody = z.infer<typeof fetchUrlBodySchema>
