import { defineStore } from 'pinia'
import type { Run, RunStatus, AnswerStep, ToolCallStep, ToolCall, TokenUsage } from '@/types/agent'
import type { RunEvent } from '@/types/events'

export const useRunStore = defineStore('run', {
  state: () => ({
    runs: new Map<string, Run>(),
    lastRunId: null as string | null,
    active: {
      runId: null as string | null,
      events: [] as RunEvent[],
      abort: null as AbortController | null,
      lastEventId: 0,
    },
    replay: {
      runId: null as string | null,
      cursor: 0,
      playing: false,
      speed: 1 as 1 | 2 | 4,
    },
  }),

  getters: {
    currentRun(state): Run | null {
      const id = state.active.runId ?? state.lastRunId
      return id ? state.runs.get(id) ?? null : null
    },
    toolCallsOfRun(state) {
      return (runId: string): ToolCall[] => {
        const run = state.runs.get(runId)
        return run ? Object.values(run.toolCalls) : []
      }
    },
    runStats(state) {
      return (runId: string) => {
        const run = state.runs.get(runId)
        const empty: TokenUsage = { prompt: 0, completion: 0, total: 0 }
        if (!run) return { steps: 0, durationMs: 0, toolCount: 0, tokens: empty }
        return {
          steps: run.steps.length,
          durationMs: run.durationMs ?? 0,
          toolCount: Object.keys(run.toolCalls).length,
          tokens: run.usage,
        }
      }
    },
    pendingApprovals(state) {
      return (runId: string): ToolCall[] => {
        const run = state.runs.get(runId)
        if (!run) return []
        return Object.values(run.toolCalls).filter(tc => tc.status === 'awaiting_approval')
      }
    },
  },

  actions: {
    createRun(runId: string, sessionId: string, userMessageId: string, model: string): Run {
      const run: Run = {
        id: runId,
        sessionId,
        userMessageId,
        assistantMessageId: '',
        model,
        status: 'pending',
        steps: [],
        toolCalls: {},
        usage: { prompt: 0, completion: 0, total: 0 },
        startedAt: Date.now(),
        events: [],
      }
      this.runs.set(runId, run)
      return run
    },

    setActive(runId: string, abort: AbortController) {
      this.active.runId = runId
      this.active.abort = abort
      this.active.events = []
      this.active.lastEventId = 0
      this.lastRunId = runId
    },

    clearActive() {
      this.active.runId = null
      this.active.abort = null
      this.active.events = []
    },

    // ★ 唯一写入点
    applyEvent(runId: string, event: RunEvent) {
      const run = this.runs.get(runId)
      if (!run) return

      run.events.push(event)
      this.active.events.push(event)

      switch (event.type) {
        case 'run_start':
          run.status = 'running'
          run.model = event.model
          run.startedAt = event.ts
          break

        case 'round_start':
          // 轮次号在创建 Step 时从事件历史中回溯读取，此处无需额外状态
          break

        case 'text_delta': {
          let step = run.steps.find(s => s.id === event.stepId) as AnswerStep | undefined
          if (!step) {
            // 回溯最近一次 round_start 确定轮次
            let round = 1
            for (let i = run.events.length - 1; i >= 0; i--) {
              const e = run.events[i]
              if (e.type === 'round_start') {
                round = e.round
                break
              }
            }
            step = {
              id: event.stepId,
              runId,
              type: 'answer',
              index: run.steps.length,
              round,
              startedAt: event.ts,
              content: '',
            }
            run.steps.push(step)
          }
          step.content += event.text
          break
        }

        case 'step_end': {
          const step = run.steps.find(s => s.id === event.stepId)
          if (step) {
            step.endedAt = event.ts
            step.durationMs = event.durationMs
            if (event.tokens) step.tokens = event.tokens
          }
          break
        }

        case 'run_end':
          run.status = event.status
          run.usage = event.usage
          run.endedAt = event.ts
          run.durationMs = event.durationMs
          break

        case 'error':
          if (event.fatal) {
            run.status = 'failed'
            run.error = event.message
          }
          break

        // ── 工具调用事件 ──────────────────────────────
        case 'tool_call_start': {
          // 创建 ToolCallStep（如果不存在）
          let step = run.steps.find(s => s.id === event.stepId) as ToolCallStep | undefined
          if (!step) {
            let round = 1
            for (let i = run.events.length - 1; i >= 0; i--) {
              const e = run.events[i]
              if (e.type === 'round_start') { round = e.round; break }
            }
            step = {
              id: event.stepId,
              runId,
              type: 'tool_call',
              index: run.steps.length,
              round,
              startedAt: event.ts,
              toolCallId: event.toolCallId,
            }
            run.steps.push(step)
          }
          // 创建 ToolCall 对象
          if (!run.toolCalls[event.toolCallId]) {
            run.toolCalls[event.toolCallId] = {
              id: event.toolCallId,
              runId,
              name: event.name,
              args: {},
              argsRaw: '',
              status: 'pending',
              requiresApproval: false,
              createdAt: event.ts,
            }
          }
          break
        }

        case 'tool_call_args_delta': {
          const tc = run.toolCalls[event.toolCallId]
          if (tc) tc.argsRaw += event.argsRaw
          break
        }

        case 'tool_call_ready': {
          const tc = run.toolCalls[event.toolCallId]
          if (tc) {
            tc.args = event.args
            tc.requiresApproval = event.requiresApproval
            // M2 阶段不需要审批，直接进入 running
            tc.status = event.requiresApproval ? 'awaiting_approval' : 'running'
            tc.startedAt = event.ts
          }
          break
        }

        case 'tool_call_result': {
          const tc = run.toolCalls[event.toolCallId]
          if (tc) {
            tc.status = event.status
            tc.result = event.result
            tc.error = event.error
            tc.durationMs = event.durationMs
            tc.endedAt = event.ts
          }
          break
        }

        // M3 审批事件：暂不投影
        case 'tool_call_awaiting_approval':
        case 'tool_call_approved':
        case 'tool_call_rejected':
          break
      }
    },

    finalizeRun(runId: string, status: RunStatus) {
      const run = this.runs.get(runId)
      if (run) {
        run.status = status
        run.endedAt = Date.now()
        run.durationMs = run.endedAt - run.startedAt
      }
    },

    // ── 以下为 M2+ 预留骨架 ──────────────────────
    approve(_toolCallId: string) { },
    reject(_toolCallId: string, _reason?: string) { },
    loadForReplay(_runId: string) { },
    seekReplay(_index: number) { },
    play() { },
    pause() { },
    setSpeed(_n: 1 | 2 | 4) { },
    flushToIDB() { },
  },
})
