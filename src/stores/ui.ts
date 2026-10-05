import { defineStore } from 'pinia'
import type { ToolCall } from '@/types/agent'

export const useUIStore = defineStore('ui', {
  state: () => ({
    trackPanelOpen: true,
    selectedToolCallId: null as string | null,
    approvalDialog: {
      open: false,
      toolCall: null as ToolCall | null,
    },
    replayMode: false,
    model: 'mock-model',
  }),

  actions: {
    openApprovalDialog(toolCall: ToolCall) {
      this.approvalDialog.open = true
      this.approvalDialog.toolCall = toolCall
    },

    closeApprovalDialog() {
      this.approvalDialog.open = false
      this.approvalDialog.toolCall = null
    },

    selectToolCall(toolCallId: string | null) {
      this.selectedToolCallId = toolCallId
    },
  },
})
