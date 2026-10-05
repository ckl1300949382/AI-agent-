<script setup lang="ts">
import { computed } from 'vue'
import type { ToolCall, ToolCallStatus } from '@/types/agent'

const props = defineProps<{ toolCall: ToolCall }>()

const statusLabel: Record<ToolCallStatus, string> = {
  pending: '等待中',
  awaiting_approval: '待审批',
  running: '执行中',
  success: '成功',
  error: '失败',
  rejected: '已拒绝',
  cancelled: '已取消',
}

const statusClass = computed(() => {
  switch (props.toolCall.status) {
    case 'success': return 'status-success'
    case 'error': return 'status-error'
    case 'running': return 'status-running'
    case 'pending': return 'status-pending'
    default: return 'status-default'
  }
})

const durationText = computed(() => {
  const d = props.toolCall.durationMs
  if (d == null) return ''
  return d < 1000 ? `${d}ms` : `${(d / 1000).toFixed(1)}s`
})
</script>

<template>
  <div class="tool-call-inline">
    <span class="icon">🛠️</span>
    <span class="name">{{ toolCall.name }}</span>
    <span class="status" :class="statusClass">{{ statusLabel[toolCall.status] }}</span>
    <span v-if="durationText" class="duration">{{ durationText }}</span>
  </div>
</template>

<style scoped>
.tool-call-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  font-size: 13px;
  margin: 4px 0;
}
.icon { font-size: 14px; }
.name { font-weight: 600; color: #303133; }
.status {
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
}
.status-success { background: #f0f9eb; color: #67c23a; }
.status-error { background: #fef0f0; color: #f56c6c; }
.status-running { background: #ecf5ff; color: #409eff; }
.status-pending { background: #fdf6ec; color: #e6a23c; }
.status-default { background: #f4f4f5; color: #909399; }
.duration { color: #909399; font-size: 12px; }
</style>
