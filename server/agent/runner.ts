import { getTool } from './tools'
import { waitForApproval, rejectAllForRun } from './approvals'
import { isCancelled } from './cancellations'
import { mockLLM, type MockLLMResponse } from '../providers/mock'

interface RunAgentParams {
  runId: string
  sessionId: string
  content: string
  model?: string
  sendEvent: (event: Record<string, unknown>) => void
}

// 可中断的 sleep：每 50ms 检查一次是否被取消
function cancellableSleep(ms: number, runId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const timer = setInterval(() => {
      if (isCancelled(runId)) {
        clearInterval(timer)
        reject(new Error('CANCELLED'))
        return
      }
      if (Date.now() - start >= ms) {
        clearInterval(timer)
        resolve()
      }
    }, 50)
  })
}

function genId(prefix: string, seed: string): string {
  return `${prefix}_${seed}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

// Agent 主循环：调 LLM → 处理工具调用 → 喂回结果 → 下一轮
export async function runAgent({ runId, content, model, sendEvent }: RunAgentParams) {
  const startedAt = Date.now()
  const modelName = model ?? 'mock-model'

  sendEvent({ type: 'run_start', runId, ts: Date.now(), model: modelName })

  let round = 1
  const toolResults: Array<{ toolCallId: string; name: string; result: unknown }> = []

  try {
    while (true) {
      // 取消检查点
      if (isCancelled(runId)) throw new Error('CANCELLED')

      sendEvent({ type: 'round_start', runId, ts: Date.now(), round })

      const stepId = `step_${runId}_${round}`
      const roundStartTs = Date.now()

      // 1. 调 LLM（mock）
      const response: MockLLMResponse = await mockLLM(content, round, toolResults)

      // 2. 推送流式文本
      if (response.text) {
        for (const ch of response.text) {
          if (isCancelled(runId)) throw new Error('CANCELLED')
          sendEvent({ type: 'text_delta', runId, ts: Date.now(), stepId, text: ch })
          await cancellableSleep(20, runId)
        }
      }

      // 3. 处理工具调用
      for (let i = 0; i < response.toolCalls.length; i++) {
        if (isCancelled(runId)) throw new Error('CANCELLED')

        const tc = response.toolCalls[i]
        const toolCallId = genId('tc', `${runId}_${round}_${i}`)
        const tool = getTool(tc.name)

        sendEvent({
          type: 'tool_call_start',
          ts: Date.now(),
          stepId,
          toolCallId,
          name: tc.name,
        })

        const argsRaw = JSON.stringify(tc.args)
        for (const ch of argsRaw) {
          if (isCancelled(runId)) throw new Error('CANCELLED')
          sendEvent({
            type: 'tool_call_args_delta',
            ts: Date.now(),
            toolCallId,
            argsRaw: ch,
          })
          await cancellableSleep(10, runId)
        }

        const requiresApproval = tool?.dangerous ?? false
        sendEvent({
          type: 'tool_call_ready',
          ts: Date.now(),
          toolCallId,
          args: tc.args,
          requiresApproval,
        })

        // M3：需要审批的工具，先挂起等待人工决策
        if (requiresApproval) {
          sendEvent({
            type: 'tool_call_awaiting_approval',
            ts: Date.now(),
            toolCallId,
          })

          const approval = await waitForApproval(toolCallId, runId)
          if (approval.decision === 'approved') {
            sendEvent({
              type: 'tool_call_approved',
              ts: Date.now(),
              toolCallId,
            })
          } else {
            sendEvent({
              type: 'tool_call_rejected',
              ts: Date.now(),
              toolCallId,
              reason: approval.reason,
            })
            toolResults.push({
              toolCallId,
              name: tc.name,
              result: `用户拒绝了该操作${approval.reason ? `：${approval.reason}` : ''}`,
            })
            continue
          }
        }

        // 执行工具
        const execStart = Date.now()
        let status: 'success' | 'error' = 'success'
        let result: unknown
        let error: string | undefined

        if (!tool) {
          status = 'error'
          error = `未知工具: ${tc.name}`
        } else {
          try {
            result = await tool.execute(tc.args)
          } catch (e) {
            status = 'error'
            error = String(e)
          }
        }

        sendEvent({
          type: 'tool_call_result',
          ts: Date.now(),
          toolCallId,
          status,
          result,
          error,
          durationMs: Date.now() - execStart,
        })

        toolResults.push({ toolCallId, name: tc.name, result: result ?? error })
      }

      // 4. step_end
      sendEvent({
        type: 'step_end',
        ts: Date.now(),
        stepId,
        durationMs: Date.now() - roundStartTs,
        tokens: {
          prompt: content.length,
          completion: response.text.length,
          total: content.length + response.text.length,
        },
      })

      // 5. 如果本轮没有工具调用，主循环结束
      if (response.toolCalls.length === 0) break

      round++
      if (round > 5) break
    }

    // run_end — 正常完成
    const endedAt = Date.now()
    sendEvent({
      type: 'run_end',
      runId,
      ts: endedAt,
      status: 'completed',
      usage: { prompt: content.length, completion: 0, total: content.length },
      durationMs: endedAt - startedAt,
    })
  } catch (e) {
    // 取消：推 run_end cancelled
    if (String(e) === 'Error: CANCELLED') {
      sendEvent({
        type: 'run_end',
        runId,
        ts: Date.now(),
        status: 'cancelled',
        usage: { prompt: content.length, completion: 0, total: content.length },
        durationMs: Date.now() - startedAt,
      })
      // 唤醒所有挂起的审批，避免前端弹窗卡住
      rejectAllForRun(runId)
    } else {
      throw e
    }
  }
}
