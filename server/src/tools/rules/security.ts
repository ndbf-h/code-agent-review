// server/src/tools/rules/security.ts
import { redactSecrets } from '../../security/prompt-guard'
import type { Rule } from './types'

export const securityRules: Rule[] = [
  {
    name: 'sql-string-concat',
    pattern:
      /(?:["'`]\s*\+\s*["'`]?\s*(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE)\b|\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE)\b[^;{]*\+["'`]?\s*\w+)/gi,
    severity: 'critical',
    category: 'SQL 注入',
    message: m => `疑似 SQL 字符串拼接：${m[0].substring(0, 40)}`,
    suggestion: '使用参数化查询（如 PreparedStatement、ORM 的占位符语法）替代字符串拼接'
  },
  {
    name: 'innerHTML',
    pattern: /\.innerHTML\s*=/gi,
    severity: 'critical',
    category: 'XSS 漏洞',
    message: '直接设置 innerHTML 可能导致 XSS 攻击',
    suggestion: '使用 textContent 替代，或对内容做 HTML 实体编码后再设置'
  },
  {
    name: 'hardcoded-secret',
    pattern: /(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"'\s]{8,}["']/gi,
    severity: 'critical',
    category: '硬编码密钥',
    // 先脱敏再截断：命中片段本身可能包含密钥原文
    message: m => `发现硬编码的敏感信息：${redactSecrets(m[0]).substring(0, 50)}...`,
    suggestion: '将密钥移至环境变量或密钥管理服务，使用 process.env 或配置中心获取'
  },
  {
    name: 'eval-usage',
    pattern: /\beval\s*\(/gi,
    severity: 'critical',
    category: '代码注入',
    message: '使用了 eval()，可能执行任意代码',
    suggestion: '避免使用 eval()，改用 JSON.parse() 或更安全的解析方式'
  },
  {
    name: 'dangerously-set-html',
    pattern: /dangerouslySetInnerHTML|v-html|\[innerHTML\]/gi,
    severity: 'warning',
    category: 'XSS 漏洞',
    message: '使用了不安全的 HTML 渲染方式',
    suggestion: '对用户输入的内容做 HTML 转义处理，或使用 DOMPurify 等安全库'
  },
  {
    name: 'path-traversal',
    pattern: /\.\.\/|\.\.\\|path\.join\s*\(\s*__dirname\s*,\s*req\.(query|params|body)/gi,
    severity: 'warning',
    category: '路径遍历',
    message: '文件路径来自用户输入，可能存在路径遍历风险',
    suggestion: '对用户输入的路径做规范化校验，禁止包含 ../ 或使用 path.resolve 限制在允许目录内'
  }
]
