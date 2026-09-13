export interface Semaphore {
  acquire(): Promise<void>
  release(): void
}

/**
 * 简单计数信号量：限制同时在途的异步操作数量。
 * 采用“槽位交接”实现——release 时若有等待者，直接把槽位移交给队首，避免计数抖动。
 */
export function createSemaphore(limit: number): Semaphore {
  let active = 0
  const waiters: Array<() => void> = []

  return {
    async acquire(): Promise<void> {
      if (limit <= 0) return
      if (active < limit) {
        active++
        return
      }
      await new Promise<void>(resolve => waiters.push(resolve))
    },
    release(): void {
      if (limit <= 0) return
      const next = waiters.shift()
      if (next) {
        next() // 槽位直接交接，active 不变
      } else {
        active = Math.max(0, active - 1)
      }
    }
  }
}
