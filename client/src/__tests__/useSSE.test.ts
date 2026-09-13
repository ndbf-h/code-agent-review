import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSSE } from '../composables/useSSE'
import { useReviewStore } from '../stores/review'

interface EmittedEvent {
  lastEventId: string
  data: string
}

type Listener = (event: EmittedEvent) => void

class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  private listeners = new Map<string, Listener[]>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) || []
    list.push(listener)
    this.listeners.set(type, list)
  }

  /** 模拟服务端推送一帧（lastEventId 对应 SSE 的 id: 行） */
  emit(type: string, lastEventId: number | '', data: unknown): void {
    const event: EmittedEvent = { lastEventId: String(lastEventId), data: JSON.stringify(data) }
    for (const listener of this.listeners.get(type) || []) listener(event)
  }

  close(): void {
    this.closed = true
  }
}

describe('useSSE 事件去重与断线续传', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource)
    FakeEventSource.instances = []
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('相同 seq 重复推送只消费一次（thinking_token 不重复拼接）', () => {
    const store = useReviewStore()
    const { connect } = useSSE()
    connect('task-1')
    const es = FakeEventSource.instances[0]

    es.emit('agent_start', 1, { role: 'security' })
    es.emit('thinking_token', 2, { role: 'security', message: 'hello' })
    es.emit('thinking_token', 2, { role: 'security', message: 'hello' })

    const slot = store.agentSlots.find(s => s.role === 'security')
    expect(slot?.streamBuffer).toBe('hello')
  })

  it('乱序到达的旧 seq 事件被丢弃，不回退状态', () => {
    const store = useReviewStore()
    const { connect } = useSSE()
    connect('task-1')
    const es = FakeEventSource.instances[0]

    es.emit('agent_start', 5, { role: 'security' })
    expect(store.status).toBe('reviewing')

    // 回放迟到的 orchestrator_start（seq 更小）不应把状态拉回 orchestrating
    es.emit('orchestrator_start', 3, { message: '开始分析' })
    expect(store.status).toBe('reviewing')
  })

  it('无 id 的快照事件（task_state）正常消费', () => {
    const store = useReviewStore()
    const { connect } = useSSE()
    connect('task-1')
    const es = FakeEventSource.instances[0]

    es.emit('task_state', '', { status: 'pending', attemptCount: 0 })
    expect(store.status).toBe('pending')
  })

  it('task_queued / task_retrying 事件写入系统消息并回到排队态', () => {
    const store = useReviewStore()
    const { connect } = useSSE()
    connect('task-1')
    const es = FakeEventSource.instances[0]

    es.emit('task_queued', 1, { message: '任务已进入审查队列' })
    es.emit('orchestrator_start', 2, { message: '开始分析' })
    es.emit('task_retrying', 3, { message: '30s 后自动重试' })

    expect(store.status).toBe('pending')
    const contents = store.messages.map(m => m.content)
    expect(contents).toContain('任务已进入审查队列')
    expect(contents).toContain('30s 后自动重试')
  })

  it('断线重连时携带 ?after= 续传位点', () => {
    const { connect, disconnect } = useSSE()
    connect('task-1')
    const first = FakeEventSource.instances[0]

    first.emit('agent_start', 7, { role: 'security' })
    first.onerror?.()
    // 首次重连退避 2000 * 2^1 = 4000ms
    vi.advanceTimersByTime(4100)

    const second = FakeEventSource.instances[1]
    expect(second).toBeDefined()
    expect(second.url).toContain('after=7')
    expect(first.closed).toBe(true)
    disconnect()
  })

  it('切换到新任务时重置续传位点（不带 after）', () => {
    const { connect, disconnect } = useSSE()
    connect('task-1')
    FakeEventSource.instances[0].emit('agent_start', 7, { role: 'security' })

    connect('task-2')
    const second = FakeEventSource.instances[1]
    expect(second.url).not.toContain('after=')
    disconnect()
  })
})
