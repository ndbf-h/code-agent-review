import { z } from 'zod'
import pkg from '../package.json'
import {
  chatBodySchema,
  createTaskBodySchema,
  fetchUrlBodySchema,
  fixBodySchema,
  guidelineBodySchema,
  TASK_STATUSES,
  taskIdParamsSchema,
  versionBodySchema
} from './validation/schemas'

/**
 * OpenAPI 3.1 文档（REQ-16）。
 *
 * 请求体 schema 直接由 REQ-04 的 zod schema 转换而来（zod v4 内置 `z.toJSONSchema`），
 * 避免文档与校验规则漂移；路径 / 说明 / 响应这类无法从 schema 推导的部分在此显式声明。
 */

type JsonObject = Record<string, unknown>

/** 把 zod schema 转成 JSON Schema；无法表示的检查（如 refine）降级为宽松描述 */
function toJsonSchema(schema: z.ZodType): JsonObject {
  try {
    return z.toJSONSchema(schema, { unrepresentable: 'any' }) as JsonObject
  } catch {
    return { type: 'object', additionalProperties: true }
  }
}

function jsonBody(schema: z.ZodType): JsonObject {
  return {
    required: true,
    content: { 'application/json': { schema: toJsonSchema(schema) } }
  }
}

function jsonResponse(description: string, schema?: JsonObject): JsonObject {
  return schema ? { description, content: { 'application/json': { schema } } } : { description }
}

const errorSchema: JsonObject = {
  type: 'object',
  properties: {
    error: { type: 'string', description: '错误说明' },
    code: { type: 'string', description: '错误码，如 VALIDATION_ERROR / UNAUTHORIZED' },
    details: { type: 'array', items: { type: 'object' }, description: '字段级校验错误' },
    requestId: { type: 'string', description: '请求追踪 ID（5xx 响应附带）' }
  },
  required: ['error', 'code']
}

const COMMON_ERRORS: JsonObject = {
  '400': jsonResponse('请求参数不合法', errorSchema),
  '401': jsonResponse('缺少或无效的 API Key', errorSchema),
  '404': jsonResponse('资源不存在', errorSchema),
  '429': jsonResponse('触发限流', errorSchema),
  '500': jsonResponse('服务内部错误', errorSchema)
}

const TASK_ID_PARAM: JsonObject = {
  name: 'id',
  in: 'path',
  required: true,
  description: '任务 UUID',
  schema: { type: 'string', format: 'uuid' }
}

const SSE_QUERY_API_KEY: JsonObject = {
  name: 'api_key',
  in: 'query',
  required: false,
  description: 'EventSource 无法自定义请求头，此路径可用查询参数传 API Key',
  schema: { type: 'string' }
}

const TASK_SCHEMA: JsonObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    language: { type: 'string' },
    status: { type: 'string', enum: [...TASK_STATUSES] },
    createdAt: { type: 'string' },
    scopeId: { type: 'string' }
  }
}

const ISSUE_SCHEMA: JsonObject = {
  type: 'object',
  properties: {
    line: { type: 'integer', minimum: 1 },
    severity: { type: 'string', enum: ['critical', 'warning', 'suggestion'] },
    category: { type: 'string' },
    message: { type: 'string' },
    suggestion: { type: 'string' }
  },
  required: ['line', 'severity', 'category', 'message', 'suggestion']
}

const REPORT_SCHEMA: JsonObject = {
  type: 'object',
  properties: {
    issues: { type: 'array', items: ISSUE_SCHEMA },
    score: { type: 'integer', minimum: 0, maximum: 100 },
    agentResults: { type: 'object' },
    reviewStatus: { type: 'object' },
    security: { type: 'object', description: '输入安全信息（命中疑似注入时存在）' },
    governance: { type: 'object', description: 'ReAct 治理统计' }
  },
  required: ['issues', 'score', 'agentResults']
}

/** 组装 OpenAPI 文档（纯函数，便于单测断言） */
export function buildOpenApiDocument(): JsonObject {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Code Agent Review API',
      version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
      description:
        '多 Agent 协作的 AI 代码审查平台 API。除健康探针、接口文档与 Webhook 外，所有接口在配置 API_KEYS 后需要携带 X-API-Key。'
    },
    servers: [{ url: '/' }],
    tags: [
      { name: 'tasks', description: '审查任务' },
      { name: 'metrics', description: '可观测性' },
      { name: 'health', description: '健康探针' },
      { name: 'docs', description: '接口文档' }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: '在服务端配置 API_KEYS 后必填；留空表示不鉴权'
        },
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: '等价写法：Authorization: Bearer <key>'
        }
      },
      schemas: {
        Task: TASK_SCHEMA,
        Issue: ISSUE_SCHEMA,
        ReviewReport: REPORT_SCHEMA,
        Error: errorSchema
      }
    },
    security: [{ ApiKeyAuth: [] }],
    paths: {
      '/api/tasks': {
        post: {
          tags: ['tasks'],
          summary: '创建审查任务并入队',
          requestBody: jsonBody(createTaskBodySchema()),
          responses: {
            '201': jsonResponse('任务已创建', TASK_SCHEMA),
            '502': jsonResponse('消息队列不可用', errorSchema),
            ...COMMON_ERRORS
          }
        },
        get: {
          tags: ['tasks'],
          summary: '查询任务列表',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: [...TASK_STATUSES] } }
          ],
          responses: { '200': jsonResponse('任务列表'), ...COMMON_ERRORS }
        }
      },
      '/api/tasks/{id}': {
        get: {
          tags: ['tasks'],
          summary: '查询任务详情、Agent、消息与报告',
          parameters: [TASK_ID_PARAM],
          responses: { '200': jsonResponse('任务详情'), ...COMMON_ERRORS }
        }
      },
      '/api/tasks/{id}/cancel': {
        post: {
          tags: ['tasks'],
          summary: '取消排队中或执行中的任务',
          parameters: [TASK_ID_PARAM],
          responses: {
            '200': jsonResponse('已取消'),
            '409': jsonResponse('任务已结束', errorSchema),
            ...COMMON_ERRORS
          }
        }
      },
      '/api/tasks/{id}/stream': {
        get: {
          tags: ['tasks'],
          summary: '订阅任务事件流（SSE：快照 + 回放 + 实时推送）',
          parameters: [TASK_ID_PARAM, SSE_QUERY_API_KEY],
          responses: {
            '200': {
              description: 'text/event-stream 事件流',
              content: { 'text/event-stream': { schema: { type: 'string' } } }
            },
            ...COMMON_ERRORS
          }
        }
      },
      '/api/tasks/{id}/chat/stream': {
        post: {
          tags: ['tasks'],
          summary: '就已完成报告与助手对话（SSE）',
          parameters: [TASK_ID_PARAM, SSE_QUERY_API_KEY],
          requestBody: jsonBody(chatBodySchema),
          responses: {
            '200': {
              description: 'text/event-stream 事件流',
              content: { 'text/event-stream': { schema: { type: 'string' } } }
            },
            ...COMMON_ERRORS
          }
        }
      },
      '/api/tasks/{id}/versions': {
        post: {
          tags: ['tasks'],
          summary: '保存一份助手生成的代码版本',
          parameters: [TASK_ID_PARAM],
          requestBody: jsonBody(versionBodySchema()),
          responses: { '201': jsonResponse('版本已保存'), ...COMMON_ERRORS }
        }
      },
      '/api/tasks/{id}/guidelines': {
        post: {
          tags: ['tasks'],
          summary: '上传任务或项目级编码规范',
          parameters: [TASK_ID_PARAM],
          requestBody: jsonBody(guidelineBodySchema()),
          responses: { '201': jsonResponse('规范已入库'), ...COMMON_ERRORS }
        }
      },
      '/api/tasks/{id}/fix': {
        post: {
          tags: ['tasks'],
          summary: '基于报告问题生成修复代码',
          parameters: [TASK_ID_PARAM],
          requestBody: jsonBody(fixBodySchema()),
          responses: {
            '200': jsonResponse('修复结果'),
            '502': jsonResponse('LLM 调用失败', errorSchema),
            ...COMMON_ERRORS
          }
        }
      },
      '/api/tasks/{id}/report.md': {
        get: {
          tags: ['tasks'],
          summary: '导出 Markdown 审查报告',
          parameters: [TASK_ID_PARAM],
          responses: {
            '200': {
              description: 'Markdown 文件',
              content: { 'text/markdown': { schema: { type: 'string' } } }
            },
            ...COMMON_ERRORS
          }
        }
      },
      '/api/tasks/{id}/report.sarif': {
        get: {
          tags: ['tasks'],
          summary: '导出 SARIF 2.1.0 报告',
          parameters: [TASK_ID_PARAM],
          responses: {
            '200': {
              description: 'SARIF 2.1.0 文档',
              content: { 'application/sarif+json': { schema: { type: 'object' } } }
            },
            ...COMMON_ERRORS
          }
        }
      },
      '/api/tasks/fetch-url': {
        post: {
          tags: ['tasks'],
          summary: '从 URL 抓取代码文本（含 SSRF 防护）',
          requestBody: jsonBody(fetchUrlBodySchema),
          responses: { '200': jsonResponse('抓取到的代码'), ...COMMON_ERRORS }
        }
      },
      '/api/metrics': {
        get: {
          tags: ['metrics'],
          summary: 'Token 用量、请求数与 Agent 阶段耗时',
          responses: { '200': jsonResponse('指标快照'), ...COMMON_ERRORS }
        }
      },
      '/api/metrics/reset': {
        post: {
          tags: ['metrics'],
          summary: '重置指标计数器',
          responses: { '200': jsonResponse('已重置'), ...COMMON_ERRORS }
        }
      },
      '/api/health': {
        get: {
          tags: ['health'],
          summary: '健康检查（live + ready 合集，?deep=1 时探测 LLM）',
          security: [],
          parameters: [{ name: 'deep', in: 'query', schema: { type: 'string', enum: ['1'] } }],
          responses: {
            '200': jsonResponse('服务状态'),
            '503': jsonResponse('依赖未就绪', errorSchema)
          }
        }
      },
      '/api/health/live': {
        get: {
          tags: ['health'],
          summary: '存活探针（不做外部调用）',
          security: [],
          responses: { '200': jsonResponse('进程存活') }
        }
      },
      '/api/health/ready': {
        get: {
          tags: ['health'],
          summary: '就绪探针（检查 PostgreSQL 与 RabbitMQ）',
          security: [],
          responses: { '200': jsonResponse('依赖就绪'), '503': jsonResponse('依赖未就绪') }
        }
      },
      '/api/openapi.json': {
        get: {
          tags: ['docs'],
          summary: 'OpenAPI 3.1 文档',
          security: [],
          responses: { '200': jsonResponse('OpenAPI 文档') }
        }
      },
      '/api/docs': {
        get: {
          tags: ['docs'],
          summary: 'Swagger UI 页面',
          security: [],
          responses: {
            '200': {
              description: 'HTML 页面',
              content: { 'text/html': { schema: { type: 'string' } } }
            }
          }
        }
      }
    }
  }
}

/** 供路由复用的路径参数 schema（与 zod 定义保持一致） */
export const taskIdParamSchema = taskIdParamsSchema
