FROM node:22-bookworm-slim AS deps

WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci

FROM deps AS build

WORKDIR /app
COPY server ./server
COPY shared ./shared
WORKDIR /app/server
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app/server

# 以镜像内置的非 root 用户 node 运行；文件归属同步切换，避免运行期写入失败
COPY --from=build --chown=node:node /app/server/package*.json ./
COPY --from=build --chown=node:node /app/server/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server/dist ./dist

USER node

EXPOSE 3001

# 进程存活探针（不触碰外部依赖）；compose / 编排平台可用 /api/health/ready 覆盖为就绪探针。
# worker 进程复用本镜像但不提供 HTTP，请在编排层为其禁用 healthcheck。
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:3001/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/server/src/index.js"]
