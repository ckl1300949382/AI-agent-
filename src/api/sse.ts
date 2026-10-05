import type { RunEvent } from '@/types/events'

export interface ConsumeResult {
  lastEventId: number
}

/**
 * 解析 SSE 流，逐条调用 onEvent。
 * 同时解析 id: 字段（即 BFF 的 seq），返回最后收到的 lastEventId，用于断线重连。
 */
export async function consume(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: RunEvent) => void,
  signal?: AbortSignal,
): Promise<ConsumeResult> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let lastEventId = 0

  const read = async (): Promise<ConsumeResult> => {
    while (true) {
      if (signal?.aborted) return { lastEventId }
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)

        // 跳过心跳注释行（:hb）
        if (chunk.startsWith(':')) continue

        const lines = chunk.split('\n')
        let data = ''
        let id = 0
        for (const line of lines) {
          if (line.startsWith('data:')) data += line.slice(5).trim()
          else if (line.startsWith('id:')) id = Number(line.slice(3).trim()) || 0
        }
        if (id) lastEventId = id
        if (data) {
          try {
            onEvent(JSON.parse(data) as RunEvent)
          } catch {
            console.warn('bad event', data)
          }
        }
      }
    }
    return { lastEventId }
  }

  try {
    return await read()
  } catch (e) {
    // AbortError 是正常的（用户主动停止），不算错误
    if ((e as Error).name === 'AbortError') return { lastEventId }
    throw e
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // ignore
    }
  }
}
