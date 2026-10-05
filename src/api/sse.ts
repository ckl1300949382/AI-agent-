import type { RunEvent } from '@/types/events'

export async function consume(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: RunEvent) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE 事件以 \n\n 分隔
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)

      // 跳过心跳注释行（:hb）
      if (chunk.startsWith(':')) continue

      const lines = chunk.split('\n')
      let data = ''
      for (const line of lines) {
        if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (data) {
        try {
          onEvent(JSON.parse(data) as RunEvent)
        } catch {
          console.warn('bad event', data)
        }
      }
    }
  }
}
