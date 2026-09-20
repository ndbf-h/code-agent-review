import { getConfig } from '../../config'
import { createLogger } from '../../logger'

const logger = createLogger('github')

/** PR 变更文件（GitHub REST 返回的子集） */
export interface GitHubPullRequestFile {
  filename: string
  status: string
  additions?: number
  deletions?: number
  patch?: string
}

export interface GitHubClient {
  listPullRequestFiles(repo: string, prNumber: number): Promise<GitHubPullRequestFile[]>
  getFileContent(repo: string, path: string, ref: string): Promise<string>
  createIssueComment(repo: string, prNumber: number, body: string): Promise<void>
}

interface GitHubClientOptions {
  token?: string
  apiBase?: string
}

/**
 * GitHub REST 客户端（REQ-15）：只覆盖 Webhook 最小闭环所需的三个接口。
 * 抽取为接口是为了让 webhook 路由可以在单测里注入假实现。
 */
export function createGitHubClient(options: GitHubClientOptions = {}): GitHubClient {
  const config = getConfig()
  const token = options.token ?? config.github.token
  const apiBase = (options.apiBase ?? config.github.apiBase).replace(/\/$/, '')

  function headers(): Record<string, string> {
    const base: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'code-agent-review'
    }
    if (token) base.Authorization = `Bearer ${token}`
    return base
  }

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${apiBase}${path}`, { ...init, headers: headers() })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      logger.warn('GitHub API 调用失败', {
        path,
        status: response.status,
        body: body.slice(0, 200)
      })
      throw new Error(`GitHub API ${response.status}`)
    }
    return (await response.json()) as T
  }

  return {
    async listPullRequestFiles(repo, prNumber) {
      const files = await call<GitHubPullRequestFile[]>(
        `/repos/${repo}/pulls/${prNumber}/files?per_page=100`
      )
      return Array.isArray(files) ? files : []
    },

    async getFileContent(repo, path, ref) {
      // contents API 对大文件返回空 content，此处只看 <1MB 的文本文件
      const data = await call<{ content?: string; encoding?: string }>(
        `/repos/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`
      )
      if (!data.content) return ''
      const normalized = data.content.replace(/\n/g, '')
      return Buffer.from(normalized, 'base64').toString('utf-8')
    },

    async createIssueComment(repo, prNumber, body) {
      await call(`/repos/${repo}/issues/${prNumber}/comments`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body })
      })
    }
  }
}
