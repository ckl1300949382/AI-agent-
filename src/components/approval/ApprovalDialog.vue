<script setup lang="ts">
import { ref, computed } from 'vue'
import { useUIStore } from '@/stores/ui'
import { useRunStore } from '@/stores/run'

const uiStore = useUIStore()
const runStore = useRunStore()
const reason = ref('')

const toolCall = computed(() => uiStore.approvalDialog.toolCall)

const argsText = computed(() => {
  try {
    return JSON.stringify(toolCall.value?.args, null, 2)
  } catch {
    return String(toolCall.value?.args)
  }
})

async function handleApprove() {
  if (!toolCall.value) return
  await runStore.approve(toolCall.value.id)
  uiStore.closeApprovalDialog()
}

async function handleReject() {
  if (!toolCall.value) return
  await runStore.reject(toolCall.value.id, reason.value || undefined)
  uiStore.closeApprovalDialog()
  reason.value = ''
}
</script>

<template>
  <el-dialog :model-value="uiStore.approvalDialog.open" title="审批确认" width="480px" :close-on-click-modal="false"
    :close-on-press-escape="false" @close="uiStore.closeApprovalDialog()">
    <div v-if="toolCall" class="approval-body">
      <div class="warning">
        <span class="icon">⚠️</span>
        <span>检测到需要审批的危险操作</span>
      </div>

      <div class="tool-info">
        <div class="row">
          <span class="label">工具名称：</span>
          <span class="value">{{ toolCall.name }}</span>
        </div>
        <div class="row">
          <span class="label">参数：</span>
          <pre class="code">{{ argsText }}</pre>
        </div>
      </div>

      <div class="reason-section">
        <div class="label">拒绝理由（可选）：</div>
        <el-input v-model="reason" type="textarea" :rows="2" placeholder="如果不批准，可以说明原因..." />
      </div>
    </div>

    <template #footer>
      <el-button @click="handleReject" type="danger" plain>
        拒绝
      </el-button>
      <el-button @click="handleApprove" type="primary">
        批准
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.approval-body {
  font-size: 14px;
}

.warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: #fdf6ec;
  border: 1px solid #f5dab1;
  border-radius: 6px;
  color: #e6a23c;
  margin-bottom: 16px;
}

.warning .icon {
  font-size: 18px;
}

.tool-info {
  margin-bottom: 16px;
}

.row {
  margin-bottom: 8px;
}

.label {
  color: #909399;
  font-size: 13px;
  margin-bottom: 4px;
}

.value {
  font-weight: 600;
  color: #303133;
}

.code {
  background: #f5f7fa;
  padding: 8px;
  border-radius: 4px;
  margin: 0;
  font-family: monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}

.reason-section {
  margin-top: 12px;
}
</style>
