import { useRunStore } from '@/stores/run'
import { useMessageStore, genId } from '@/stores/message'
import { consume } from '@/api/sse'
import type { Message } from '@/types/agent'

export function useRunStream() {
  const runStore = useRunStore()
  const messageStore = useMessageStore()

  async function startRun(params: {
    sessionId: string
    content: string
    model?: string
    regenerateFromRunId?: string
  }) {
    const abort = new AbortController()

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Last-Event-ID': String(runStore.active.lastEventId ?? 0),
      },
      body: JSON.stringify({
        mode: params.regenerateFromRunId ? 'regenerate' : 'new',
        sessionId: params.sessionId,
        content: params.content,
        model: params.model,
        fromRunId: params.regenerateFromRunId,
      }),
      signal: abort.signal,
    })

    if (!res.ok || !res.body) throw new Error(`SSE failed: ${res.status}`)

    const runId = res.headers.get('X-Run-Id')!
    const model = params.model ?? 'mock-model'

    // 1. 创建 user 消息
    const userMessage: Message = {
      id: genId('msg'),
      sessionId: params.sessionId,
      role: 'user',
      blocks: [{ type: 'text', text: params.content }],
      createdAt: Date.now(),
      status: 'done',
    }
    messageStore.addMessage(userMessage)

    // 2. 创建 assistant 占位消息
    const assistantMessageId = genId('msg')
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

    // 3. 创建 run 并回填 assistantMessageId
    const run = runStore.createRun(runId, params.sessionId, userMessage.id, model)
    run.assistantMessageId = assistantMessageId

    runStore.setActive(runId, abort)
    messageStore.beginStreaming(assistantMessageId)

    // 4. 消费事件流：状态走 applyEvent，文本/工具桥接到 messageStore
    await consume(res.body, (event) => {
      runStore.applyEvent(runId, event)

      if (event.type === 'text_delta') {
        messageStore.appendTextDelta(event.text)
      } else if (event.type === 'tool_call_start') {
        // 工具调用开始：先提交已有文本块，再追加工具引用
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
    })

    runStore.flushToIDB()
    runStore.clearActive()
  }

  function stop() {
    if (runStore.active.runId) {
      runStore.active.abort?.abort()
      runStore.finalizeRun(runStore.active.runId, 'cancelled')
    }
  }

  return { startRun, stop }
}
