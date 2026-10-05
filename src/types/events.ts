import type { RunStatus, TokenUsage } from './agent'

export type RunEvent =
  // 生命周期
  | { type: 'run_start'; runId: string; ts: number; model: string }
  | {
      type: 'run_end'
      runId: string
      ts: number
      status: RunStatus
      usage: TokenUsage
      durationMs: number
    }
  | { type: 'error'; runId: string; ts: number; message: string; fatal: boolean }
  // 轮次
  | { type: 'round_start'; runId: string; ts: number; round: number }
  // 流式文本
  | { type: 'text_delta'; runId: string; ts: number; stepId: string; text: string }
  // 工具调用
  | {
      type: 'tool_call_start'
      ts: number
      stepId: string
      toolCallId: string
      name: string
    }
  | {
      type: 'tool_call_args_delta'
      ts: number
      toolCallId: string
      argsRaw: string
    }
  | {
      type: 'tool_call_ready'
      ts: number
      toolCallId: string
      args: Record<string, unknown>
      requiresApproval: boolean
    }
  | { type: 'tool_call_awaiting_approval'; ts: number; toolCallId: string }
  | { type: 'tool_call_approved'; ts: number; toolCallId: string }
  | {
      type: 'tool_call_rejected'
      ts: number
      toolCallId: string
      reason?: string
    }
  | {
      type: 'tool_call_result'
      ts: number
      toolCallId: string
      status: 'success' | 'error'
      result?: unknown
      error?: string
      durationMs: number
    }
  // 步骤结束
  | {
      type: 'step_end'
      ts: number
      stepId: string
      durationMs: number
      tokens?: TokenUsage
    }
