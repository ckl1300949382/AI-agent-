// ── 基础枚举 ──────────────────────────────
import type { RunEvent } from './events'

export type MessageRole = 'system' | 'user' | 'assistant'

export type RunStatus =
    | 'pending'
    | 'running'
    | 'awaiting_approval'
    | 'completed'
    | 'failed'
    | 'cancelled'

export type StepType = 'tool_call' | 'answer'

export type ToolCallStatus =
    | 'pending'
    | 'awaiting_approval'
    | 'running'
    | 'success'
    | 'error'
    | 'rejected'
    | 'cancelled'

// ── 消息层 ────────────────────────────────
export type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'tool_call'; toolCallId: string }

export interface Message {
    id: string
    sessionId: string
    role: MessageRole
    blocks: ContentBlock[]
    createdAt: number
    status: 'streaming' | 'done' | 'error' | 'cancelled'
    runId?: string
    error?: string
}

// ── 工具调用 ──────────────────────────────
export interface ToolCall {
    id: string
    runId: string
    name: string
    args: Record<string, unknown>
    argsRaw: string
    status: ToolCallStatus
    requiresApproval: boolean
    approval?: {
        decision: 'approved' | 'rejected'
        decidedAt: number
        reason?: string
    }
    result?: unknown
    resultPreview?: string
    error?: string
    createdAt: number
    startedAt?: number
    endedAt?: number
    durationMs?: number
}

export interface ToolMeta {
    name: string
    displayName: string
    description: string
    icon?: string
    dangerous: boolean
    argsSchema?: Record<string, unknown>
}

// ── 步骤与运行 ────────────────────────────
export interface TokenUsage {
    prompt: number
    completion: number
    total: number
    cached?: number
}

interface BaseStep {
    id: string
    runId: string
    index: number
    round: number
    startedAt: number
    endedAt?: number
    durationMs?: number
    tokens?: TokenUsage
}

export interface ToolCallStep extends BaseStep {
    type: 'tool_call'
    toolCallId: string
}

export interface AnswerStep extends BaseStep {
    type: 'answer'
    content: string
}

export type Step = ToolCallStep | AnswerStep

export interface Run {
    id: string
    sessionId: string
    userMessageId: string
    assistantMessageId: string
    model: string
    status: RunStatus
    steps: Step[]
    toolCalls: Record<string, ToolCall>
    usage: TokenUsage
    startedAt: number
    endedAt?: number
    durationMs?: number
    error?: string
    events: RunEvent[]
}

// ── 会话 ──────────────────────────────────
export interface Session {
    id: string
    title: string
    createdAt: number
    updatedAt: number
    messageIds: string[]
    runIds: string[]
    stats: {
        runCount: number
        toolCallCount: number
        totalTokens: number
    }
}
