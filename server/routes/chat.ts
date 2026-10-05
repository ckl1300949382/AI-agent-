import { Router, type Request, type Response } from 'express'
import { runAgent } from '../agent/runner'

export const chatRouter = Router()

chatRouter.post('/chat', async (req: Request, res: Response) => {
  const { sessionId, content, model } = req.body as {
    sessionId: string
    content: string
    model?: string
  }

  // SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  res.setHeader('X-Run-Id', runId)
  res.flushHeaders()

  const sendEvent = (event: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  const sendHeartbeat = () => res.write(':hb\n\n')

  // 15s 心跳
  const heartbeat = setInterval(sendHeartbeat, 15000)

  try {
    await runAgent({ runId, sessionId, content, model, sendEvent })
  } catch (e) {
    sendEvent({
      type: 'error',
      runId,
      ts: Date.now(),
      message: String(e),
      fatal: true,
    })
  } finally {
    clearInterval(heartbeat)
    res.end()
  }
})
