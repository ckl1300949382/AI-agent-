import { Router, type Request, type Response } from 'express'
import { resolveApproval, rejectAllForRun } from '../agent/approvals'
import { markCancelled } from '../agent/cancellations'
import { listTools } from '../agent/tools'

export const runsRouter = Router()

// POST /api/runs/:runId/approval
// Body: { toolCallId, decision: 'approved' | 'rejected', reason? }
runsRouter.post('/runs/:runId/approval', (req: Request, res: Response) => {
  const { toolCallId, decision, reason } = req.body as {
    toolCallId: string
    decision: 'approved' | 'rejected'
    reason?: string
  }

  if (!toolCallId || !decision) {
    res.status(400).json({ error: 'toolCallId 和 decision 必填' })
    return
  }

  resolveApproval(toolCallId, decision, reason)
  res.json({ ok: true })
})

// POST /api/runs/:runId/cancel
// 无 body。标记 run 为已取消，runner 会在下一个检查点退出并推 run_end cancelled
runsRouter.post('/runs/:runId/cancel', (req: Request, res: Response) => {
  const { runId } = req.params
  markCancelled(runId)
  // 如果 run 正卡在审批等待，一并唤醒（以 rejected）
  rejectAllForRun(runId)
  res.json({ ok: true })
})

// GET /api/tools：返回工具元信息（不含 execute 函数）
runsRouter.get('/tools', (_req: Request, res: Response) => {
  res.json(listTools().map(({ execute: _execute, ...meta }) => meta))
})
