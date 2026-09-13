FROM node:22-bookworm-slim

WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci

WORKDIR /app
COPY client ./client
WORKDIR /app/client

ARG VITE_API_BASE=http://localhost:3001/api
ENV VITE_API_BASE=$VITE_API_BASE

RUN npm run build

EXPOSE 5173
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5173"]
