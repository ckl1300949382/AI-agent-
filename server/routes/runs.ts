import { Router, type Request, type Response } from 'express'
import { resolveApproval } from '../agent/approvals'
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
runsRouter.post('/runs/:runId/cancel', (_req: Request, res: Response) => {
  // M4 阶段实现
  res.json({ ok: true })
})

// GET /api/tools：返回工具元信息（不含 execute 函数）
runsRouter.get('/tools', (_req: Request, res: Response) => {
  res.json(listTools().map(({ execute: _execute, ...meta }) => meta))
})
