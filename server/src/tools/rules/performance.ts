// server/src/tools/rules/performance.ts
import type { Rule } from './types'

export const performanceRules: Rule[] = [
  {
    name: 'loop-query',
    pattern: /for\s*\([^)]*\)\s*\{[^}]*\.(query|find|findOne|findAll)\s*\(/gi,
    severity: 'warning',
    category: 'N+1 查询',
    message: '循环内部检测到数据库查询调用',
    suggestion: '使用批量查询（如 WHERE IN、findByIds）替代逐条查询，减少数据库往返次数'
  },
  {
    name: 'sync-fs-in-server',
    pattern: /(readFileSync|writeFileSync|existsSync|mkdirSync)\s*\(/gi,
    severity: 'warning',
    category: '同步阻塞',
    message: (m) => `使用了同步文件操作 ${m[1]}()，可能阻塞事件循环`,
    suggestion: '改用异步版本（如 fs.promises.readFile）或使用流式处理'
  },
  {
    name: 'sync-sleep',
    pattern: /while\s*\(\s*Date\.now|sleep\s*\(\s*\d+\s*\)/gi,
    severity: 'warning',
    category: '同步阻塞',
    message: '使用了阻塞式等待/轮询模式',
    suggestion: '使用 setTimeout/Promise 等异步方式替代同步等待'
  },
  {
    name: 'large-array-copy',
    pattern: /\.slice\s*\(\s*0\s*\)|\.concat\s*\(\s*\[\s*\]\s*\)|\.map\s*\([^)]*\)[\s\n]*\.filter|JSON\.parse\s*\(\s*JSON\.stringify/gi,
    severity: 'suggestion',
    category: '内存拷贝',
    message: '对大型数组进行了浅拷贝或双重遍历',
    suggestion: '考虑使用生成器/迭代器延迟计算，或使用 structuredClone 替代 JSON 序列化'
  }
]
