<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useMessageStore } from '@/stores/message'
import { useRunStore } from '@/stores/run'
import { useUIStore } from '@/stores/ui'
import { useSessionStore } from '@/stores/session'
import { useRunStream } from '@/composables/useRunStream'
import ToolCallInline from '@/components/conversation/ToolCallInline.vue'
import ToolCallDetail from '@/components/track/ToolCallDetail.vue'
import ApprovalDialog from '@/components/approval/ApprovalDialog.vue'
import type { ToolCall } from '@/types/agent'

const messageStore = useMessageStore()
const runStore = useRunStore()
const uiStore = useUIStore()
const sessionStore = useSessionStore()
const { startRun, stop } = useRunStream()

const input = ref('')

// 当前会话 ID（响应式）
const sessionId = computed(() => sessionStore.currentSessionId ?? '')

// 监听待审批工具：有就自动弹出；没有（被取消/拒绝）则关闭
watch(
  () => {
    const run = runStore.currentRun
    if (!run) return 0
    return runStore.pendingApprovals(run.id).length
  },
  (len) => {
    if (len > 0 && !uiStore.approvalDialog.open) {
      const run = runStore.currentRun!
      const pending = runStore.pendingApprovals(run.id)
      uiStore.openApprovalDialog(pending[0])
    } else if (len === 0 && uiStore.approvalDialog.open) {
      uiStore.closeApprovalDialog()
    }
  },
)

// 切换会话时：加载该会话的消息，清空当前 run 显示
watch(
  () => sessionStore.currentSessionId,
  async (newId) => {
    if (!newId) return
    runStore.lastRunId = null
    await messageStore.loadBySession(newId)
  },
)

// 新建会话
function handleNewSession() {
  sessionStore.createSession()
}

// 切换会话
function handleSelectSession(id: string) {
  sessionStore.selectSession(id)
}

// 删除会话
async function handleDeleteSession(id: string) {
  await sessionStore.deleteSession(id)
}

// 重新生成：找上一条用户消息，用同样内容再跑一次新 run
function handleRegenerate() {
  if (!sessionId.value) return
  const messages = messageStore.messagesOfSession(sessionId.value)
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  if (!lastUserMsg) return
  const textBlock = lastUserMsg.blocks.find((b) => b.type === 'text')
  const content = textBlock?.type === 'text' ? textBlock.text : ''
  if (!content) return
  startRun({
    sessionId: sessionId.value,
    content,
    regenerateFromRunId: runStore.lastRunId ?? undefined,
  }).catch((e) => console.error('regenerate failed', e))
}

// 根据 toolCallId 从所有 run 中查找 ToolCall
function findToolCall(toolCallId: string): ToolCall | null {
  for (const run of runStore.runs.values()) {
    const tc = run.toolCalls[toolCallId]
    if (tc) return tc
  }
  return null
}

async function handleSend() {
  const content = input.value.trim()
  if (!content || !sessionId.value) return
  input.value = ''
  try {
    await startRun({ sessionId: sessionId.value, content })
  } catch (e) {
    console.error('run failed', e)
  }
}
</script>

<template>
  <div class="console">
    <!-- 最左侧：会话列表 -->
    <div class="session-sidebar">
      <div class="sidebar-header">
        <el-button type="primary" size="small" @click="handleNewSession">+ 新会话</el-button>
      </div>
      <div class="session-list">
        <div v-for="s in sessionStore.sessionList" :key="s.id" class="session-item"
          :class="{ active: s.id === sessionId }" @click="handleSelectSession(s.id)">
          <span class="session-title">{{ s.title }}</span>
          <el-button type="danger" size="small" link @click.stop="handleDeleteSession(s.id)">删除</el-button>
        </div>
        <div v-if="sessionStore.sessionList.length === 0" class="empty-session">
          暂无会话，点击上方新建
        </div>
      </div>
    </div>

    <!-- 中间：对话流 -->
    <div class="conversation">
      <div class="messages">
        <div v-for="msg in messageStore.messagesOfSession(sessionId)" :key="msg.id" class="msg" :class="msg.role">
          <div class="role">{{ msg.role }}</div>
          <div class="content">
            <template v-for="(block, i) in msg.blocks" :key="i">
              <span v-if="block.type === 'text'">{{ block.text }}</span>
              <ToolCallInline v-else-if="block.type === 'tool_call' && findToolCall(block.toolCallId)"
                :tool-call="findToolCall(block.toolCallId)!" />
            </template>
            <!-- 流式期间：实时显示 streamingText -->
            <span v-if="msg.id === messageStore.streamingMessageId" class="streaming">
              {{ messageStore.streamingText }}
            </span>
          </div>
        </div>
      </div>

      <div class="input-area">
        <el-input v-model="input" placeholder="输入消息，回车发送（试试 weather / multi / fail / db）" @keyup.enter="handleSend" />
        <el-button type="primary" @click="handleSend">发送</el-button>
        <el-button @click="stop" :disabled="!runStore.active.runId">停止</el-button>
        <el-button @click="handleRegenerate" :disabled="!runStore.lastRunId || !!runStore.active.runId">重新生成</el-button>
      </div>
    </div>

    <!-- 右侧：运行轨迹面板 -->
    <div class="track">
      <h3>运行轨迹</h3>
      <div v-if="runStore.currentRun" class="run-info">
        <div><b>Run ID:</b> {{ runStore.currentRun.id }}</div>
        <div><b>状态:</b> {{ runStore.currentRun.status }}</div>
        <div><b>模型:</b> {{ runStore.currentRun.model }}</div>
        <div><b>事件数:</b> {{ runStore.currentRun.events.length }}</div>
      </div>
      <div v-else class="empty">暂无运行，发送一条消息开始。</div>

      <!-- 工具调用详情 -->
      <div v-if="runStore.currentRun && runStore.toolCallsOfRun(runStore.currentRun.id).length" class="tool-section">
        <h4>工具调用</h4>
        <ToolCallDetail v-for="tc in runStore.toolCallsOfRun(runStore.currentRun.id)" :key="tc.id" :tool-call="tc" />
      </div>

      <!-- 原始事件流 -->
      <div class="events">
        <div v-for="(e, i) in (runStore.currentRun?.events ?? [])" :key="i" class="event">
          <span class="event-type">{{ e.type }}</span>
          <span class="event-ts">{{ new Date(e.ts).toLocaleTimeString() }}</span>
        </div>
      </div>
    </div>
    <!-- 审批弹窗 -->
    <ApprovalDialog />
  </div>
</template>

<style scoped>
.console {
  display: flex;
  height: 100vh;
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
}

/* 会话侧边栏 */
.session-sidebar {
  width: 200px;
  border-right: 1px solid #eee;
  display: flex;
  flex-direction: column;
  background: #fafafa;
}

.sidebar-header {
  padding: 12px;
  border-bottom: 1px solid #eee;
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  margin-bottom: 4px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.session-item:hover {
  background: #f0f2f5;
}

.session-item.active {
  background: #e8f3ff;
  color: #409eff;
}

.session-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-session {
  color: #999;
  font-size: 12px;
  text-align: center;
  padding: 20px 0;
}

.conversation {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.msg {
  margin-bottom: 16px;
}

.msg.user .role {
  color: #409eff;
}

.msg.assistant .role {
  color: #67c23a;
}

.role {
  font-weight: bold;
  margin-bottom: 4px;
}

.content {
  white-space: pre-wrap;
  line-height: 1.6;
}

.streaming {
  color: #67c23a;
}

.input-area {
  display: flex;
  gap: 8px;
  padding: 16px;
  border-top: 1px solid #eee;
}

.input-area .el-input {
  flex: 1;
}

.track {
  width: 380px;
  border-left: 1px solid #eee;
  padding: 16px;
  overflow-y: auto;
  background: #fafafa;
}

.track h3 {
  margin-top: 0;
}

.run-info {
  margin-bottom: 12px;
  font-size: 13px;
  line-height: 1.8;
}

.empty {
  color: #999;
  font-size: 13px;
}

.tool-section {
  margin: 12px 0;
}

.tool-section h4 {
  margin: 8px 0;
  font-size: 13px;
  color: #303133;
}

.event {
  padding: 4px 0;
  border-bottom: 1px solid #f0f0f0;
  font-family: monospace;
  font-size: 12px;
}

.event-type {
  color: #409eff;
  margin-right: 8px;
  font-weight: bold;
}

.event-ts {
  color: #999;
}
</style>
