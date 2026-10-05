import { defineStore } from 'pinia'
import type { Message } from '@/types/agent'
import { messageRepo } from '@/db/repo'

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
export { genId }

export const useMessageStore = defineStore('message', {
  state: () => ({
    messages: new Map<string, Message>(),
    streamingMessageId: null as string | null,
    streamingText: '',
  }),

  getters: {
    messagesOfSession(state) {
      return (sessionId: string): Message[] => {
        return Array.from(state.messages.values())
          .filter((m) => m.sessionId === sessionId)
          .sort((a, b) => a.createdAt - b.createdAt)
      }
    },
  },

  actions: {
    addMessage(msg: Message) {
      this.messages.set(msg.id, msg)
      // 立即持久化（消息新增不频繁）
      messageRepo.put(msg)
    },

    beginStreaming(messageId: string) {
      this.streamingMessageId = messageId
      this.streamingText = ''
    },

    appendTextDelta(text: string) {
      this.streamingText += text
    },

    commitStreamingText() {
      if (this.streamingMessageId && this.streamingText) {
        const msg = this.messages.get(this.streamingMessageId)
        if (msg) {
          msg.blocks.push({ type: 'text', text: this.streamingText })
        }
      }
      this.streamingText = ''
    },

    appendToolRef(messageId: string, toolCallId: string) {
      const msg = this.messages.get(messageId)
      if (msg) {
        msg.blocks.push({ type: 'tool_call', toolCallId })
      }
    },

    finalizeMessage(messageId: string, status: Message['status']) {
      const msg = this.messages.get(messageId)
      if (msg) {
        msg.status = status
        // 流式结束，持久化最终消息
        messageRepo.put(msg)
      }
      if (this.streamingMessageId === messageId) {
        this.streamingMessageId = null
        this.streamingText = ''
      }
    },

    clearStreaming() {
      this.streamingMessageId = null
      this.streamingText = ''
    },

    // ── 持久化 ──────────────────────────────
    // 从 IndexedDB 加载某个会话的所有消息
    async loadBySession(sessionId: string) {
      const msgs = await messageRepo.getBySession(sessionId)
      for (const m of msgs) {
        this.messages.set(m.id, m)
      }
    },

    // 把内存中所有消息写入 IndexedDB（beforeunload 时调用）
    async flushToIDB() {
      const msgs = Array.from(this.messages.values())
      await messageRepo.putBatch(msgs)
    },
  },
})
