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

const statusDotClass = computed(() => {
  switch (props.toolCall.status) {
    case 'success': return 'dot-success'
    case 'error': return 'dot-error'
    case 'running': return 'dot-running'
    case 'pending': return 'dot-pending'
    default: return 'dot-default'
  }
})

const argsText = computed(() => {
  try {
    return JSON.stringify(props.toolCall.args, null, 2)
  } catch {
    return String(props.toolCall.args)
  }
})

const resultText = computed(() => {
  if (props.toolCall.error) return props.toolCall.error
  if (props.toolCall.result == null) return '（无结果）'
  try {
    return JSON.stringify(props.toolCall.result, null, 2)
  } catch {
    return String(props.toolCall.result)
  }
})
</script>

<template>
  <div class="tool-detail">
    <div class="header">
      <span class="dot" :class="statusDotClass"></span>
      <span class="name">{{ toolCall.name }}</span>
      <span class="status">{{ statusLabel[toolCall.status] }}</span>
    </div>

    <div class="section">
      <div class="label">参数</div>
      <pre class="code">{{ argsText }}</pre>
    </div>

    <div v-if="toolCall.status === 'success' || toolCall.status === 'error'" class="section">
      <div class="label">结果</div>
      <pre class="code" :class="{ error: toolCall.status === 'error' }">{{ resultText }}</pre>
    </div>

    <div v-if="toolCall.durationMs != null" class="meta">
      耗时: {{ toolCall.durationMs < 1000 ? `${toolCall.durationMs}ms` : `${(toolCall.durationMs / 1000).toFixed(1)}s` }}
    </div>
  </div>
</template>

<style scoped>
.tool-detail {
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 10px;
  font-size: 12px;
}
.header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.dot-success { background: #67c23a; }
.dot-error { background: #f56c6c; }
.dot-running { background: #409eff; animation: pulse 1s infinite; }
.dot-pending { background: #e6a23c; }
.dot-default { background: #909399; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
.name { font-weight: 600; color: #303133; }
.status { color: #909399; font-size: 11px; }
.section { margin-bottom: 6px; }
.label { color: #909399; font-size: 11px; margin-bottom: 2px; }
.code {
  background: #f5f7fa;
  padding: 6px 8px;
  border-radius: 4px;
  margin: 0;
  font-family: monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 120px;
  overflow-y: auto;
}
.code.error { color: #f56c6c; }
.meta { color: #909399; font-size: 11px; }
</style>
