// 审批挂起 / 唤醒机制
// 核心：runner 执行到危险工具时，await 一个 Promise
// 用户 POST /api/runs/:runId/approval 后，resolve 这个 Promise，runner 继续

const pending = new Map<string, {
  resolve: (result: { decision: 'approved' | 'rejected'; reason?: string }) => void
}>()

/**
 * 等待审批。
 * runner 在需要审批的工具调用处 await 此函数，会阻塞直到用户审批。
 */
export function waitForApproval(toolCallId: string): Promise<{
  decision: 'approved' | 'rejected'
  reason?: string
}> {
  return new Promise((resolve) => {
    pending.set(toolCallId, { resolve })
  })
}

/**
 * 审批决策传入，唤醒挂起的 runner。
 * 由 POST /api/runs/:runId/approval 路由调用。
 */
export function resolveApproval(
  toolCallId: string,
  decision: 'approved' | 'rejected',
  reason?: string,
) {
  const p = pending.get(toolCallId)
  if (p) {
    p.resolve({ decision, reason })
    pending.delete(toolCallId)
  }
}
