import axios, { isAxiosError, type AxiosInstance } from 'axios'

/**
 * 统一 HTTP 客户端（REQ-12）。
 *
 * - `baseURL` 集中在 VITE_API_BASE，取代各组件手工拼接；
 * - 请求拦截器自动附带 `X-API-Key`（密钥保存在 localStorage）；
 * - 401 时派发全局事件，由界面提示用户配置密钥；
 * - `sseUrl()` 为 EventSource 生成带 `api_key` 的地址（无法自定义请求头）。
 */

export const API_BASE: string = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api'

const API_KEY_STORAGE = 'car.apiKey'

/** 鉴权失败事件名 */
export const UNAUTHORIZED_EVENT = 'car:unauthorized'

export function getApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

export function setApiKey(key: string): void {
  try {
    if (key.trim()) localStorage.setItem(API_KEY_STORAGE, key.trim())
    else localStorage.removeItem(API_KEY_STORAGE)
  } catch {
    // 隐私模式等场景下 localStorage 不可用，静默忽略
  }
}

export const http: AxiosInstance = axios.create({
  baseURL: API_BASE,
  timeout: 120_000
})

http.interceptors.request.use(config => {
  const key = getApiKey()
  if (key) config.headers.set('X-API-Key', key)
  return config
})

http.interceptors.response.use(
  response => response,
  error => {
    if (isAxiosError(error) && error.response?.status === 401) {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
    }
    return Promise.reject(error)
  }
)

/** 生成 SSE 地址：EventSource 无法自定义请求头，密钥走查询参数 */
export function sseUrl(path: string): string {
  const key = getApiKey()
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
  return key ? `${url}?api_key=${encodeURIComponent(key)}` : url
}

/** 供原生 fetch 使用的鉴权头（流式响应等 axios 不擅长的场景） */
export function authHeaders(): Record<string, string> {
  const key = getApiKey()
  return key ? { 'X-API-Key': key } : {}
}

export { isAxiosError }
