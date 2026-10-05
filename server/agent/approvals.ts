// 审批挂起 / 唤醒机制
// 核心：runner 执行到危险工具时，await 一个 Promise
// 用户 POST /api/runs/:runId/approval 后，resolve 这个 Promise，runner 继续

interface PendingApproval {
  toolCallId: string
  runId: string
  resolve: (result: { decision: 'approved' | 'rejected'; reason?: string }) => void
}

const pending = new Map<string, PendingApproval>()

export function waitForApproval(
  toolCallId: string,
  runId: string,
): Promise<{
  decision: 'approved' | 'rejected'
  reason?: string
}> {
  return new Promise((resolve) => {
    pending.set(toolCallId, { toolCallId, runId, resolve })
  })
}

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

// 取消时：把该 run 下所有挂起审批全部以 rejected 唤醒
export function rejectAllForRun(runId: string) {
  for (const [toolCallId, p] of pending) {
    if (p.runId === runId) {
      p.resolve({ decision: 'rejected', reason: '运行已被用户取消' })
      pending.delete(toolCallId)
    }
  }
}
