import { Router, type Request, type Response } from 'express'
import { runAgent } from '../agent/runner'

export const chatRouter = Router()

// ── 运行流管理：支持断线重连 ──────────────────────
// 每个 run 有一个事件流，存储所有事件 + seq
// 多个 HTTP 连接可以订阅同一个 run 的事件流（重连场景）
interface RunStream {
  events: Array<{ seq: number; event: Record<string, unknown> }>
  seq: number
  ended: boolean
  // 当前订阅该 run 的 SSE 连接（可能有多个：重连时旧连接未完全断开）
  listeners: Array<(event: Record<string, unknown>, seq: number) => void>
}

const runStreams = new Map<string, RunStream>()

function getOrCreateStream(runId: string): { stream: RunStream; isNew: boolean } {
  let stream = runStreams.get(runId)
  if (stream) return { stream, isNew: false }
  stream = { events: [], seq: 0, ended: false, listeners: [] }
  runStreams.set(runId, stream)
  return { stream, isNew: true }
}

chatRouter.post('/chat', async (req: Request, res: Response) => {
  const { sessionId, content, model, runId: clientRunId } = req.body as {
    sessionId: string
    content: string
    model?: string
    // 断线重连时前端传回原 runId，BFF 用它找到事件流续推
    runId?: string
  }

  const lastEventId = Number(req.headers['last-event-id'] ?? 0)

  // 新请求生成 runId；重连使用前端传回的 runId
  const runId = clientRunId ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const { stream, isNew } = getOrCreateStream(runId)

  // SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Run-Id', runId)
  res.setHeader('X-Accel-Buffering', 'no') // 禁用 Nginx/代理缓冲

  // ── 1. 重连：补发 lastEventId 之后的事件 ──
  for (const { seq, event } of stream.events) {
    if (seq > lastEventId) {
      res.write(`id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`)
    }
  }

  // 如果 run 已经结束，补发完就关闭
  if (stream.ended) {
    res.end()
    return
  }

  // ── 2. 订阅事件流 ──
  const listener = (event: Record<string, unknown>, seq: number) => {
    res.write(`id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`)
  }
  stream.listeners.push(listener)

  // 当前连接的心跳（每个连接独立）
  const heartbeat = setInterval(() => res.write(':hb\n\n'), 15000)

  // 连接断开时移除监听（用 res.on('close') 而非 req.on('close')）
  res.on('close', () => {
    stream.listeners = stream.listeners.filter((l) => l !== listener)
    clearInterval(heartbeat)
  })

  // ── 3. sendEvent：写入事件流 + 广播给所有监听者 ──
  const sendEvent = (event: Record<string, unknown>) => {
    stream.seq++
    const seq = stream.seq
    stream.events.push({ seq, event })
    // 广播（复制一份 listeners，避免遍历时被修改）
    const snapshot = [...stream.listeners]
    for (const l of snapshot) l(event, seq)
    if (event.type === 'run_end' || event.type === 'error') {
      stream.ended = true
      // 1 分钟后清理，避免内存泄漏
      setTimeout(() => runStreams.delete(runId), 60000)
    }
  }

  // ── 4. 只有新 run 才启动 agent；重连只续推 ──
  if (isNew) {
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
    }
  }
  // 注：重连请求不需要 await，它的生命周期由连接断开控制
})
