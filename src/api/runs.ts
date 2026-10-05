/**
 * 审批相关 API
 */

interface ApprovalBody {
  toolCallId: string
  decision: 'approved' | 'rejected'
  reason?: string
}

export async function postApproval(runId: string, body: ApprovalBody): Promise<void> {
  const res = await fetch(`/api/runs/${runId}/approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`审批失败: ${res.status} ${err}`)
  }
  // 消费响应体，避免 Chrome 报 ERR_ABORTED
  await res.json()
}

export async function postCancel(runId: string): Promise<void> {
  const res = await fetch(`/api/runs/${runId}/cancel`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`取消失败: ${res.status} ${err}`)
  }
  await res.json()
}

