import { ref, type Ref } from 'vue'

export function useTypewriter(speed = 20) {
  const displayText: Ref<string> = ref('')
  const isTyping: Ref<boolean> = ref(false)
  let buffer = ''
  let timer: ReturnType<typeof setTimeout> | null = null

  /** 追加文本到缓冲区，启动打字机 */
  function pushText(text: string): void {
    buffer += text
    if (!isTyping.value) {
      startTyping()
    }
  }

  function startTyping(): void {
    if (buffer.length === 0) {
      isTyping.value = false
      return
    }
    isTyping.value = true

    const charsPerTick = Math.max(1, Math.floor(buffer.length / 100) * 4) // 动态速度
    const chunk = buffer.substring(0, charsPerTick)
    buffer = buffer.substring(charsPerTick)
    displayText.value += chunk

    timer = setTimeout(startTyping, speed)
  }

  /** 立即显示全部剩余文本 */
  function flush(): void {
    if (timer) clearTimeout(timer)
    displayText.value += buffer
    buffer = ''
    isTyping.value = false
  }

  /** 重置 */
  function reset(): void {
    if (timer) clearTimeout(timer)
    displayText.value = ''
    buffer = ''
    isTyping.value = false
  }

  return { displayText, isTyping, pushText, flush, reset }
}
