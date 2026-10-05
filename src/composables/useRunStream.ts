import { useRunStore } from '@/stores/run'
import { useMessageStore, genId } from '@/stores/message'
import { consume } from '@/api/sse'
import { postCancel } from '@/api/runs'
import type { Message } from '@/types/agent'

const MAX_RECONNECT = 3

export function useRunStream() {
  const runStore = useRunStore()
  const messageStore = useMessageStore()

  /**
   * 启动一次 run（新建或重新生成）。
   * regenerateFromRunId 不为空时表示重新生成，BFF 会用 fromRunId 关联。
   */
  async function startRun(params: {
    sessionId: string
    content: string
    model?: string
    regenerateFromRunId?: string
  }) {
    const abort = new AbortController()

    // 初始请求：不带 runId，BFF 生成；重连时复用同一个 runId
    let runId = ''
    let assistantMessageId = ''
    let lastEventId = 0
    let reconnectCount = 0

    while (true) {
      const isReconnect = runId !== ''

      const res: Response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Last-Event-ID': String(lastEventId),
        },
        body: JSON.stringify({
          mode: params.regenerateFromRunId ? 'regenerate' : 'new',
          sessionId: params.sessionId,
          content: params.content,
          model: params.model,
          fromRunId: params.regenerateFromRunId,
          // 重连时传回原 runId，BFF 据此续推事件
          runId: runId || undefined,
        }),
        signal: abort.signal,
      })

      if (!res.ok || !res.body) throw new Error(`SSE failed: ${res.status}`)

      // 首次请求：从 header 拿 runId，创建 user/assistant 消息
      if (!isReconnect) {
        runId = res.headers.get('X-Run-Id')!
        const model = params.model ?? 'mock-model'

        const userMessage: Message = {
          id: genId('msg'),
          sessionId: params.sessionId,
          role: 'user',
          blocks: [{ type: 'text', text: params.content }],
          createdAt: Date.now(),
          status: 'done',
        }
        messageStore.addMessage(userMessage)

        assistantMessageId = genId('msg')
        const assistantMessage: Message = {
          id: assistantMessageId,
          sessionId: params.sessionId,
          role: 'assistant',
          blocks: [],
          createdAt: Date.now(),
          status: 'streaming',
          runId,
        }
        messageStore.addMessage(assistantMessage)

        const run = runStore.createRun(runId, params.sessionId, userMessage.id, model)
        run.assistantMessageId = assistantMessageId

        runStore.setActive(runId, abort)
        messageStore.beginStreaming(assistantMessageId)
      }

      // 消费事件流
      try {
        const result = await consume(res.body, (event) => {
          runStore.applyEvent(runId, event)

          if (event.type === 'text_delta') {
            messageStore.appendTextDelta(event.text)
          } else if (event.type === 'tool_call_start') {
            messageStore.commitStreamingText()
            messageStore.appendToolRef(assistantMessageId, event.toolCallId)
          } else if (event.type === 'step_end') {
            messageStore.commitStreamingText()
          } else if (event.type === 'run_end') {
            messageStore.finalizeMessage(
              assistantMessageId,
              event.status === 'cancelled' ? 'cancelled' : 'done',
            )
          } else if (event.type === 'error' && event.fatal) {
            messageStore.finalizeMessage(assistantMessageId, 'error')
          }
        }, abort.signal)

        lastEventId = result.lastEventId
        runStore.active.lastEventId = lastEventId
      } catch (e) {
        // 用户主动停止：跳出
        if ((e as Error).name === 'AbortError') break

        // run 已结束（收到 run_end），无需重连
        const run = runStore.runs.get(runId)
        if (run && (run.status === 'completed' || run.status === 'cancelled' || run.status === 'failed')) break

        // 断线重连
        reconnectCount++
        if (reconnectCount > MAX_RECONNECT) break
        // 退避重连
        await new Promise((r) => setTimeout(r, 500 * reconnectCount))
        continue
      }

      // 正常消费完毕（连接正常关闭），跳出循环
      break
    }

    runStore.flushToIDB()
    runStore.clearActive()
  }

  /**
   * 停止当前 run：通知 BFF 取消，然后中断 SSE 连接。
   */
  async function stop() {
    const runId = runStore.active.runId
    if (!runId) return
    try {
      await postCancel(runId)
    } catch (e) {
      console.warn('cancel 请求失败', e)
    }
    runStore.active.abort?.abort()
    runStore.finalizeRun(runId, 'cancelled')
  }

  return { startRun, stop }
}
