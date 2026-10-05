import { defineStore } from 'pinia'
import type { Message } from '@/types/agent'

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
          .filter(m => m.sessionId === sessionId)
          .sort((a, b) => a.createdAt - b.createdAt)
      }
    },
  },

  actions: {
    addMessage(msg: Message) {
      this.messages.set(msg.id, msg)
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
      if (msg) msg.status = status
      if (this.streamingMessageId === messageId) {
        this.streamingMessageId = null
        this.streamingText = ''
      }
    },

    clearStreaming() {
      this.streamingMessageId = null
      this.streamingText = ''
    },
  },
})
