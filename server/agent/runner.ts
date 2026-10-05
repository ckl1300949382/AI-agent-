import { getTool } from './tools'
import { waitForApproval } from './approvals'
import { mockLLM, type MockLLMResponse } from '../providers/mock'

interface RunAgentParams {
  runId: string
  sessionId: string
  content: string
  model?: string
  sendEvent: (event: Record<string, unknown>) => void
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
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
  // 上一轮工具执行结果，喂给下一轮 LLM
  const toolResults: Array<{ toolCallId: string; name: string; result: unknown }> = []

  while (true) {
    sendEvent({ type: 'round_start', runId, ts: Date.now(), round })

    const stepId = `step_${runId}_${round}`
    const roundStartTs = Date.now()

    // 1. 调 LLM（mock）
    const response: MockLLMResponse = await mockLLM(content, round, toolResults)

    // 2. 推送流式文本
    if (response.text) {
      for (const ch of response.text) {
        sendEvent({ type: 'text_delta', runId, ts: Date.now(), stepId, text: ch })
        await sleep(20)
      }
    }

    // 3. 处理工具调用
    for (let i = 0; i < response.toolCalls.length; i++) {
      const tc = response.toolCalls[i]
      const toolCallId = genId('tc', `${runId}_${round}_${i}`)
      const tool = getTool(tc.name)

      // tool_call_start
      sendEvent({
        type: 'tool_call_start',
        ts: Date.now(),
        stepId,
        toolCallId,
        name: tc.name,
      })

      // tool_call_args_delta：逐字推送 argsRaw（模拟流式拼接参数）
      const argsRaw = JSON.stringify(tc.args)
      for (const ch of argsRaw) {
        sendEvent({
          type: 'tool_call_args_delta',
          ts: Date.now(),
          toolCallId,
          argsRaw: ch,
        })
        await sleep(10)
      }

      // tool_call_ready：参数就绪，告知是否需要审批
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

        // 挂起当前 loop，直到用户在前端点击批准/拒绝（POST /approval 唤醒）
        const approval = await waitForApproval(toolCallId)
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
          // 跳过执行，把拒绝结果喂回 LLM
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

      // tool_call_result
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
    if (response.toolCalls.length === 0) {
      break
    }

    round++
    // 避免无限循环，最多 5 轮
    if (round > 5) break
  }

  // run_end
  const endedAt = Date.now()
  const totalDuration = endedAt - startedAt
  sendEvent({
    type: 'run_end',
    runId,
    ts: endedAt,
    status: 'completed',
    usage: {
      prompt: content.length,
      completion: 0,
      total: content.length,
    },
    durationMs: totalDuration,
  })
}
