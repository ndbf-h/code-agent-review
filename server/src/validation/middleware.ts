import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { ZodType } from 'zod'
import { ValidationError } from '../errors'

type SchemaSource = ZodType | (() => ZodType)

export interface ValidateSpec {
  body?: SchemaSource
  query?: SchemaSource
  params?: SchemaSource
}

export interface FieldIssue {
  location: 'body' | 'query' | 'params'
  field: string
  message: string
}

/** 校验通过后的强类型入参，挂在 res.locals.validated 上供处理器读取 */
export interface Validated<B = unknown, Q = unknown, P = unknown> {
  body: B
  query: Q
  params: P
}

function resolve(source: SchemaSource): ZodType {
  return typeof source === 'function' ? source() : source
}

/**
 * 入参校验中间件：按 spec 校验 body / query / params，
 * 全部失败项汇总为一个 ValidationError（400，details 为字段级数组）。
 * 通过后把解析结果（含默认值与类型转换）写回 req.body / req.params，并挂到 res.locals.validated。
 */
export function validate(spec: ValidateSpec): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const issues: FieldIssue[] = []
    const validated: Validated = { body: req.body, query: req.query, params: req.params }

    for (const location of ['params', 'query', 'body'] as const) {
      const source = spec[location]
      if (!source) continue
      const result = resolve(source).safeParse(req[location] ?? {})
      if (result.success) {
        validated[location] = result.data
        continue
      }
      for (const issue of result.error.issues) {
        issues.push({
          location,
          field: issue.path.map(String).join('.') || '(root)',
          message: issue.message
        })
      }
    }

    if (issues.length > 0) {
      next(new ValidationError('请求参数不合法', issues))
      return
    }

    if (spec.body) req.body = validated.body
    if (spec.params) req.params = validated.params as Request['params']
    res.locals.validated = validated
    next()
  }
}

/** 读取已校验的入参（需先经过 validate 中间件） */
export function getValidated<B = unknown, Q = unknown, P = unknown>(
  res: Response
): Validated<B, Q, P> {
  return res.locals.validated as Validated<B, Q, P>
}
