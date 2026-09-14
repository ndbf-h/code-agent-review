# ── 构建阶段：产出静态资源 ──
FROM node:22-bookworm-slim AS build

WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci

WORKDIR /app
COPY client ./client
COPY shared ./shared
WORKDIR /app/client

# 构建期注入的 API 地址（浏览器侧访问 server 的地址）
ARG VITE_API_BASE=http://localhost:3001/api
ENV VITE_API_BASE=$VITE_API_BASE

RUN npm run build

# ── 运行阶段：非 root 的 nginx 托管 SPA，监听 8080 ──
FROM nginxinc/nginx-unprivileged:alpine AS runtime

COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["wget", "--quiet", "--tries=1", "--spider", "http://localhost:8080/healthz"]
