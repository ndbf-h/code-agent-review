import { Router } from 'express'
import { buildOpenApiDocument } from '../openapi'

/** Swagger UI 通过 CDN 加载，避免引入新的运行时依赖 */
const SWAGGER_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Code Agent Review API 文档</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui.bundle.js" crossorigin></script>
    <script>
      window.ui = SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#swagger-ui' })
    </script>
  </body>
</html>`

/** 接口文档路由（REQ-16）：/api/openapi.json 与 /api/docs，均无需鉴权 */
export function createDocsRouter(): Router {
  const router = Router()

  router.get('/openapi.json', (_req, res) => {
    res.json(buildOpenApiDocument())
  })

  router.get('/docs', (_req, res) => {
    res.type('text/html; charset=utf-8').send(SWAGGER_HTML)
  })

  return router
}
