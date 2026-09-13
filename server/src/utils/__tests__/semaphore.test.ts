import { describe, it, expect } from 'vitest'
import { createSemaphore } from '../semaphore'

describe('createSemaphore 并发信号量', () => {
  it('并发数不超过上限', async () => {
    const gate = createSemaphore(2)
    let active = 0
    let peak = 0

    const task = async (): Promise<void> => {
      await gate.acquire()
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 10))
      active--
      gate.release()
    }

    await Promise.all(Array.from({ length: 8 }, () => task()))
    expect(peak).toBe(2)
  })

  it('超限请求排队等待槽位释放', async () => {
    const gate = createSemaphore(1)
    const order: string[] = []

    const first = (async () => {
      await gate.acquire()
      order.push('first-acquired')
      await new Promise(resolve => setTimeout(resolve, 20))
      gate.release()
    })()

    const second = (async () => {
      await gate.acquire()
      order.push('second-acquired')
      gate.release()
    })()

    await Promise.all([first, second])
    expect(order).toEqual(['first-acquired', 'second-acquired'])
  })
})
