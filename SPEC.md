# SPEC.md

```markdown
# Vue3 AI Agent 任务执行台 — 项目规格说明书

> 版本：v0.1
> 状态：契约层已冻结，可进入实现阶段
> 本文档是项目的单一真相源（Single Source of Truth），所有实现以本文档为准

---

## 目录

- [1. 项目概述](#1-项目概述)
- [2. 核心设计原则](#2-核心设计原则)
- [3. 技术栈](#3-技术栈)
- [4. 领域模型](#4-领域模型)
- [5. SSE 事件协议](#5-sse-事件协议)
- [6. IndexedDB Schema](#6-indexeddb-schema)
- [7. Pinia Store 结构](#7-pinia-store-结构)
- [8. SSE 消费 Composable](#8-sse-消费-composable)
- [9. BFF 路由契约](#9-bff-路由契约)
- [10. BFF 内部结构](#10-bff-内部结构)
- [11. 关键决策记录](#11-关键决策记录)
- [12. 开发路线](#12-开发路线)

---

## 1. 项目概述

一个 Vue3 实现的 **AI Agent 运行控制台**，不是普通聊天页。核心能力：

- 多会话对话，流式输出，支持停止生成 / 重新生成
- 工具调用可视化卡片，区分调用中 / 成功 / 失败 / 等待确认
- 危险工具的人工审批（批准 / 拒绝）
- 右侧运行轨迹面板：步骤、耗时、工具次数、Token 统计
- 一次 Agent 运行可保存为 JSON 并**回放**
- 轻量 BFF 代理模型 API，隐藏 Key，mock / 真实模式可切换
- Markdown + 代码高亮 + 复制 + DOMPurify 防 XSS
- IndexedDB 持久化会话

---

## 2. 核心设计原则

### 2.1 事件流是唯一真相，UI 状态是投影

一次运行产生的所有状态变化，都以 **`RunEvent`** 的形式记录。UI 展示的 Step、ToolCall、Token 统计，全部是这批事件 `apply` 之后的投影。

这带来三个好处：

1. **回放零成本**：`for (const e of run.events) applyEvent(e)` 就是回放
2. **断线重连**：BFF 按 `Last-Event-ID` 续推即可
3. **可调试**：一次运行的完整事件流就是一份 JSON，可下载、可分析

### 2.2 唯一写入点

`useRunStore.applyEvent(runId, event)` 是**所有状态变更的唯一入口**。实时流、回放、断线重连都走这一个函数。任何绕过它直接改 state 的代码都视为 bug。

### 2.3 对话流轻量，详情归右侧

对话流里 tool call 只渲染一个条（图标 + 名称 + 状态徽章 + 耗时）；args / result / 错误详情全部在右侧轨迹面板渲染。这是性能与体验的平衡点。

---

## 3. 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Vue 3 + Vite + TypeScript |
| 状态 | Pinia |
| 路由 | Vue Router |
| UI | Element Plus 或 Naive UI（实现阶段二选一，模型层不依赖） |
| BFF | Express + Node |
| 通信 | SSE（`fetch` + `ReadableStream` 手搓，非 `EventSource`） |
| 持久化 | IndexedDB（建议 `idb` 库） |
| Markdown | `markdown-it` 或 `marked` |
| 高亮 | `shiki` 或 `highlight.js` |
| 净化 | `DOMPurify` |

---

## 4. 领域模型

> 文件：`src/types/agent.ts`

### 4.1 基础枚举

​```ts
export type MessageRole = 'system' | 'user' | 'assistant';

export type RunStatus =
  | 'pending'            // 已创建未开始
  | 'running'
  | 'awaiting_approval'  // 运行级挂起，等待人工审批
  | 'completed'
  | 'failed'
  | 'cancelled';         // 用户主动停止

export type StepType = 'tool_call' | 'answer';
// 说明：v0.1 不展示 think 步骤。若未来接入 R1 类模型，
// 通过 ContentBlock 增加 think 分支即可，不影响其它设计。

export type ToolCallStatus =
  | 'pending'            // 模型刚吐出 tool_call，参数仍在流式拼接
  | 'awaiting_approval'
  | 'running'
  | 'success'
  | 'error'
  | 'rejected'
  | 'cancelled';
```

**注意**：`RunStatus.awaiting_approval` 是**运行级**暂停，`ToolCallStatus.awaiting_approval` 是**调用级**。一个 run 挂起时可能同时有多个 tool call 在等审批。

### 4.2 消息层

**关键决策**：assistant 消息用 `blocks` 而非纯 `content`。因为流式过程中"文本片段"与"工具调用"交错出现，纯字符串无法表达顺序。

```ts
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; toolCallId: string };  // 卡片内联在对话流里

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  blocks: ContentBlock[];
  createdAt: number;
  status: 'streaming' | 'done' | 'error' | 'cancelled';
  runId?: string;        // assistant 消息关联的 run
  error?: string;
}
```

user 消息恒为 `blocks: [{ type: 'text', text: '...' }]`。

### 4.3 工具调用

```ts
export interface ToolCall {
  id: string;
  runId: string;
  name: string;
  args: Record<string, unknown>;
  argsRaw: string;              // 流式拼接的原始 JSON，便于调试 / 回放
  status: ToolCallStatus;
  requiresApproval: boolean;

  approval?: {
    decision: 'approved' | 'rejected';
    decidedAt: number;
    reason?: string;
  };

  result?: unknown;
  resultPreview?: string;       // 卡片上展示的摘要
  error?: string;

  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
}
```

工具元信息（BFF 下发，前端用于渲染卡片与审批弹窗）：

```ts
export interface ToolMeta {
  name: string;
  displayName: string;
  description: string;
  icon?: string;
  dangerous: boolean;                    // 决定是否需要审批
  argsSchema?: Record<string, unknown>;  // JSON Schema，用于审批表单
}
```

### 4.4 步骤与运行

```ts
export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
  cached?: number;
}

interface BaseStep {
  id: string;
  runId: string;
  index: number;      // run 内全局顺序
  round: number;      // 第几轮 LLM 调用（用于分组统计）
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  tokens?: TokenUsage;
}

export interface ToolCallStep extends BaseStep {
  type: 'tool_call';
  toolCallId: string;
}

export interface AnswerStep extends BaseStep {
  type: 'answer';
  content: string;
}

export type Step = ToolCallStep | AnswerStep;
```

**`round` 字段很重要**：一次 run 里模型可能被调用多轮（answer → tool → answer → tool → answer），按 round 分组才能算每轮耗时与 token。

```ts
export interface Run {
  id: string;
  sessionId: string;
  userMessageId: string;
  assistantMessageId: string;
  model: string;
  status: RunStatus;

  steps: Step[];
  toolCalls: Record<string, ToolCall>;   // id → ToolCall，Step 用 id 引用

  usage: TokenUsage;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  error?: string;

  events: RunEvent[];     // ★ 回放的唯一数据源
}
```

**为什么 `toolCalls` 用 map 而非数组**：ToolCall 状态会变化（pending → awaiting → running → success），而 Step 只是"发起动作"的记录，两者生命周期不同。

### 4.5 会话

```ts
export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageIds: string[];
  runIds: string[];
  stats: {
    runCount: number;
    toolCallCount: number;
    totalTokens: number;
  };
}
```

---

## 5. SSE 事件协议

> 文件：`src/types/events.ts`

前端收到的每个 SSE 事件**原样 append 到 `Run.events`**。UI 状态由这批事件投影而来。回放即按 `ts` 间隔重新播放这批事件。

```ts
export type RunEvent =
  // ── 生命周期 ──────────────────────────────
  | { type: 'run_start';    runId: string; ts: number; model: string }
  | { type: 'run_end';      runId: string; ts: number; status: RunStatus;
                            usage: TokenUsage; durationMs: number }
  | { type: 'error';        runId: string; ts: number; message: string; fatal: boolean }

  // ── 轮次 ────────────────────────────────
  | { type: 'round_start';  runId: string; ts: number; round: number }

  // ── 流式文本 ─────────────────────────────
  | { type: 'text_delta';   runId: string; ts: number; stepId: string; text: string }

  // ── 工具调用：从发起到出结果 ─────────────────
  | { type: 'tool_call_start';              ts: number; stepId: string;
                                            toolCallId: string; name: string }
  | { type: 'tool_call_args_delta';         ts: number; toolCallId: string;
                                            argsRaw: string }
  | { type: 'tool_call_ready';              ts: number; toolCallId: string;
                                            args: Record<string, unknown>;
                                            requiresApproval: boolean }
  | { type: 'tool_call_awaiting_approval';  ts: number; toolCallId: string }
  | { type: 'tool_call_approved';           ts: number; toolCallId: string }
  | { type: 'tool_call_rejected';           ts: number; toolCallId: string;
                                            reason?: string }
  | { type: 'tool_call_result';             ts: number; toolCallId: string;
                                            status: 'success' | 'error';
                                            result?: unknown; error?: string;
                                            durationMs: number }

  // ── 步骤结束 ─────────────────────────────
  | { type: 'step_end';     ts: number; stepId: string;
                            durationMs: number; tokens?: TokenUsage };
```

### 5.1 SSE 报文格式

每条事件：

```
data: {"type":"text_delta","runId":"run_x","ts":1712345678901,"stepId":"s1","text":"你"}\n\n
```

心跳（前端直接丢弃）：

```
:hb\n\n
```

### 5.2 序号与重连

BFF 应给每条事件带 `id:` 字段（即 `seq`），前端记录 `lastEventId`。断线时以 `Last-Event-ID` 头重新 POST，BFF 补推 `seq > lastEventId` 的事件。

（`seq` 在 §6 的 events 表里作为复合主键的一部分。）

---

## 6. IndexedDB Schema

> 文件：`src/db/schema.ts`

**不要整个 Session 作为一个大对象存储**。分表存储：

| store      | keyPath        | index                    | 说明                      |
| ---------- | -------------- | ------------------------ | ------------------------- |
| `sessions` | `id`           | `updatedAt`              | 会话元信息                |
| `messages` | `id`           | `sessionId`, `createdAt` | 消息体                    |
| `runs`     | `id`           | `sessionId`, `startedAt` | 运行元信息（不含 events） |
| `events`   | `[runId, seq]` | `runId`                  | 事件流，单独一张表        |

**`events` 单独分表的原因**：一次 run 的事件流可能几百上千条，塞进 `runs` 记录里会让读写变慢。回放时按 `runId` 拉取即可。

**持久化策略**：

- 流式期间**内存为主**，每 **500ms** 或每 **50 条事件** flush 一次
- `run_end` 时补一次完整写入
- 会话切换、页面 `beforeunload` 时强制 flush

---

## 7. Pinia Store 结构

按职责分 4 个 store，不要合并成大杂烩。

### 7.1 `useSessionStore`

```ts
state: {
  sessions: Map<id, Session>
  currentSessionId: string | null
  loading: boolean
}
getters: {
  currentSession
  sessionList                 // 按 updatedAt 排序
}
actions: {
  loadAll()                   // 从 IndexedDB 拉
  createSession(title?)
  selectSession(id)
  updateTitle(id, title)
  deleteSession(id)           // 级联删 messages / runs / events
  bumpUpdatedAt(id)           // 有新消息时调用
}
```

### 7.2 `useMessageStore`

```ts
state: {
  messages: Map<id, Message>          // 全局，用 sessionId 索引
  streamingMessageId: string | null   // 当前正在流式的 assistant 消息
  // ★ 流式热路径缓冲：流式期间文本只写这里，不改 Message.blocks
  streamingText: string
}
getters: {
  messagesOfSession: (sessionId) => Message[]
}
actions: {
  addMessage(msg)
  beginStreaming(messageId)           // 初始化 streamingText = ''
  appendTextDelta(text)               // 只改 streamingText，O(1)
  commitStreamingText()               // 把 streamingText 写入 blocks，清空
  appendToolRef(messageId, toolCallId)
  finalizeMessage(messageId, status)
  clearStreaming()
}
```

**性能要点**：`appendTextDelta` 在流式期间每秒可能被调用几十次。**不要让它在 `blocks` 数组里查找**——流式期间只写 `streamingText`（一个 ref 字符串），UI 上文字照样实时出现（响应式），但数据结构稳定。只在 `step_end` / `tool_call_start` 等"文本段落结束"时机调用 `commitStreamingText()` 一次性写入 blocks。

### 7.3 `useRunStore`（最核心）

```ts
state: {
  runs: Map<runId, Run>
  active: {
    runId: string | null
    events: RunEvent[]
    abort: AbortController | null
    lastEventId: number
  }
  replay: {
    runId: string | null
    cursor: number              // 当前播放到第几个事件
    playing: boolean
    speed: 1 | 2 | 4
  }
}
getters: {
  currentRun
  toolCallsOfRun: (runId) => ToolCall[]
  runStats: (runId) => { steps, durationMs, toolCount, tokens }
  pendingApprovals: (runId) => ToolCall[]     // 给审批弹窗用
}
actions: {
  // ── 生命周期 ──────────────────────────────
  createRun(sessionId, userMessageId, model): Run
  applyEvent(runId, event)          // ★ 唯一写入点，回放也调它
  finalizeRun(runId, status)

  // ── 流控制（不直接建连，由 composable 调） ────────
  setActive(runId, abort)
  clearActive()

  // ── 审批 ────────────────────────────────
  approve(toolCallId)
  reject(toolCallId, reason?)

  // ── 回放 ────────────────────────────────
  loadForReplay(runId)              // 从 IndexedDB 拉 events
  seekReplay(index)
  play() / pause() / setSpeed(n)

  // ── 持久化 ──────────────────────────────
  flushToIDB()
}
```

**`applyEvent` 职责**：根据 `event.type` 更新 `runs[runId]` 的 `steps / toolCalls / usage / status`，同时 append 到 `active.events`。

### 7.4 `useUIStore`

```ts
state: {
  trackPanelOpen: boolean
  selectedToolCallId: string | null
  approvalDialog: { open: boolean; toolCall: ToolCall | null }
  replayMode: boolean
  model: string
}
```

---

## 8. SSE 消费 Composable

> 文件：`src/composables/useRunStream.ts`

因为需要 POST body + 自定义 header + `AbortController`，**不用原生 `EventSource`**，用 `fetch` + `ReadableStream` 手搓。

```ts
export function useRunStream() {
  const runStore = useRunStore();

  async function startRun(params: {
    sessionId: string;
    content?: string;
    regenerateFromRunId?: string;
  }) {
    const abort = new AbortController();

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Last-Event-ID': String(runStore.active.lastEventId ?? 0),
      },
      body: JSON.stringify(params),
      signal: abort.signal,
    });

    if (!res.ok || !res.body) throw new Error(`SSE failed: ${res.status}`);

    const runId = res.headers.get('X-Run-Id')!;
    runStore.createRun(/* ... */);
    runStore.setActive(runId, abort);

    await consume(res.body, (event) => {
      runStore.applyEvent(runId, event);
    });

    runStore.flushToIDB();
    runStore.clearActive();
  }

  function stop() {
    runStore.active.abort?.abort();
    runStore.finalizeRun(runStore.active.runId!, 'cancelled');
  }

  return { startRun, stop };
}
```

### 8.1 SSE 解析器

```ts
async function consume(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: RunEvent) => void
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE 事件以 \n\n 分隔
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      // 跳过心跳注释行
      if (chunk.startsWith(':')) continue;

      const lines = chunk.split('\n');
      let data = '';
      for (const line of lines) {
        if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (data) {
        try { onEvent(JSON.parse(data)); }
        catch (e) { console.warn('bad event', data); }
      }
    }
  }
}
```

### 8.2 心跳与重连

- BFF 每 **15s** 发 `:hb\n\n`，前端 `startsWith(':')` 直接丢弃
- 捕获 reader 报错后，若 run 未结束，用 `Last-Event-ID` 重新 POST
- 重连逻辑放 composable，不放 store

---

## 9. BFF 路由契约

**原则**：mock 与真实模式端点、请求体、响应体**完全一致**，只换 handler。

### 9.1 路由表

```
POST /api/chat                        → SSE 流 (Content-Type: text/event-stream)
POST /api/runs/:runId/approval        → 200 JSON
POST /api/runs/:runId/cancel          → 200 JSON
GET  /api/tools                       → ToolMeta[]
```

### 9.2 `POST /api/chat`

**Request body**（用 discriminant 区分）：

```ts
type ChatRequest =
  | { mode: 'new';        sessionId: string; content: string; model?: string }
  | { mode: 'regenerate'; sessionId: string; fromRunId: string; model?: string }
```

**Response headers**：

```
Content-Type: text/event-stream
X-Run-Id: run_xxx
Cache-Control: no-cache
Connection: keep-alive
```

**Response body**：`RunEvent` 的 SSE 序列，每条 `data: {json}\n\n`。心跳 `:hb\n\n`。

### 9.3 `POST /api/runs/:runId/approval`

```ts
// body
{
  toolCallId: string;
  decision: 'approved' | 'rejected';
  reason?: string;
}
```

BFF 收到后唤醒挂起的 run，原 SSE 连接继续推 `tool_call_approved` / `tool_call_rejected` 事件。

### 9.4 `POST /api/runs/:runId/cancel`

无 body。BFF 中断上游（DeepSeek）请求，向 SSE 推 `run_end` 且 `status: 'cancelled'`。

### 9.5 `GET /api/tools`

返回 `ToolMeta[]`。前端启动时拉一次缓存，用于渲染卡片标题、判断 `dangerous` 决定是否弹审批。

---

## 10. BFF 内部结构

```
server/
  index.ts              // Express 启动
  routes/
    chat.ts             // 流式端点
    runs.ts             // approval / cancel
    tools.ts            // 工具元信息
  agent/
    runner.ts           // ★ Agent 主循环，产出 RunEvent
    tools.ts            // 工具注册表 + 执行器
    approvals.ts        // 挂起 / 唤醒的 Promise map
  providers/
    mock.ts             // 造假的 token 流 + 工具调用
    deepseek.ts         // 调真实 API
  index.switch.ts       // 根据 env.MODE 选择 provider
```

### 10.1 `runner.ts` 主循环

1. 调 LLM（流式），边推 `text_delta` 边累积文本
2. 若 LLM 吐出 tool_calls，逐个推 `tool_call_start` → `args_delta` → `ready`
3. 检查工具是否 `dangerous`；需要审批则推 `awaiting_approval` 并 **await 一个 Promise**（存到 `approvals.ts` 的 map，key 是 toolCallId）
4. 审批通过则执行工具，推 `tool_call_result`
5. 把 tool result 作为新消息喂回 LLM，进入下一轮（`round_start`）
6. 直到 LLM 不再调工具，推 `run_end`

### 10.2 挂起 / 唤醒机制

```ts
// server/agent/approvals.ts
const pending = new Map<string, {
  resolve: (d: 'approved' | 'rejected', reason?: string) => void
}>();

export function waitForApproval(toolCallId: string): Promise<...> {
  return new Promise((resolve) => {
    pending.set(toolCallId, { resolve });
  });
}

export function resolveApproval(toolCallId: string, decision, reason?) {
  const p = pending.get(toolCallId);
  if (p) {
    p.resolve(decision, reason);
    pending.delete(toolCallId);
  }
}
```

### 10.3 mock provider

**在接入 DeepSeek 之前，mock 要能把前端所有 UI 状态跑通**，包括：审批挂起、工具失败、多轮调用、连续 3 次工具调用、用户取消。

建议 mock 支持"脚本化演出"——比如按 keyword 触发不同场景：

- 输入包含 `weather` → 触发单次工具调用
- 输入包含 `db` → 触发危险工具（需审批）
- 输入包含 `multi` → 触发连续三次工具调用
- 输入包含 `fail` → 触发工具执行失败

---

## 11. 关键决策记录

| #    | 决策                                   | 理由                                                       |
| ---- | -------------------------------------- | ---------------------------------------------------------- |
| D1   | 对话流轻量占位 + 右侧完整详情          | 流式期间只 append 纯文本，性能最优；详情在轨迹面板统一渲染 |
| D2   | SSE 长连接 + 15s 心跳 + POST 审批唤醒  | 实现简单，交互即时                                         |
| D3   | 重新生成 = 新 run，`runIds` 追加       | 旧 run 保留可回放对比，支持多版本                          |
| D4   | v0.1 不展示 think 步骤                 | 目标模型可能不输出思考；未来通过 ContentBlock 扩展         |
| D5   | 内存 + 500ms/50 条节流落盘             | 流式期间不写库，run_end 补一次完整写，兼顾性能与可靠性     |
| D6   | 事件流是唯一真相，UI 是投影            | 回放零成本，断线重连简单，可调试                           |
| D7   | `applyEvent` 作为唯一写入点            | 实时流与回放走同一函数，避免双份逻辑                       |
| D8   | IndexedDB 分表存储（含 events 独立表） | 避免大对象读写，回放时按 runId 拉取                        |

---

## 12. 开发路线

按里程碑推进，**每个里程碑都必须能独立运行**。

### M1 — 最小闭环

- [ ] Vite + TS + Pinia + Router 脚手架
- [ ] `src/types/agent.ts` / `events.ts` 完整落地
- [ ] BFF Express 启动，mock provider 只吐文本
- [ ] `useRunStore` + `useMessageStore` 骨架
- [ ] `useRunStream` + `consume` 解析器
- [ ] 纯文本流式聊天跑通

**验收**：输入一段话，右侧轨迹面板显示 `run_start` / `round_start` / `text_delta` / `run_end`。

### M2 — 工具调用

- [ ] BFF `runner.ts` 主循环 + 工具注册表
- [ ] mock 支持单次 / 多次工具调用
- [ ] 对话流内联工具条（轻量占位）
- [ ] 右侧轨迹面板渲染 ToolCall 详情
- [ ] `tool_call_*` 全事件流打通

**验收**：输入触发关键词，能看到工具调用从 `pending` → `running` → `success` 全状态流转。

### M3 — 人工审批

- [ ] `ToolMeta.dangerous` 判定
- [ ] `approvals.ts` 挂起/唤醒机制
- [ ] 审批弹窗（批准 / 拒绝 + 理由）
- [ ] POST `/api/runs/:runId/approval` 唤醒原 SSE 连接

**验收**：危险工具触发弹窗，批准后继续，拒绝后 run 正确收尾。

### M4 — 流控制

- [ ] 停止生成（AbortController + `run_end cancelled`）
- [ ] 重新生成（新 run 追加）
- [ ] 断线重连（`Last-Event-ID`）

### M5 — 持久化

- [ ] IndexedDB 四表落地
- [ ] 会话列表、切换、删除
- [ ] 节流 flush 机制

### M6 — 回放

- [ ] 导出 run JSON
- [ ] 加载历史 run 并 `applyEvent` 重放
- [ ] 播放 / 暂停 / 倍速 / 进度条

### M7 — 体验打磨

- [ ] Markdown + 代码高亮 + 复制
- [ ] DOMPurify
- [ ] 空态 / 加载态 / 错误态
- [ ] Token / 耗时统计面板

---

## 附录 A：目录结构建议

```
src/
  types/
    agent.ts            # 领域模型
    events.ts           # SSE 事件类型
  db/
    schema.ts           # IndexedDB 定义
    repo.ts             # 增删查封装
  stores/
    session.ts
    message.ts
    run.ts
    ui.ts
  composables/
    useRunStream.ts
    useMarkdown.ts
  api/
    http.ts             # fetch 封装
    sse.ts              # consume 解析器
  views/
    Console.vue         # 主页面
  components/
    conversation/
      MessageList.vue
      MessageItem.vue
      ToolCallInline.vue      # 对话流里的轻量条
      StreamingText.vue
    track/
      TrackPanel.vue
      StepTimeline.vue
      ToolCallDetail.vue      # 右侧完整详情
      RunStats.vue
    approval/
      ApprovalDialog.vue
    replay/
      ReplayBar.vue
    common/
      Markdown.vue
      CodeBlock.vue
server/
  # 见 §10
```

---

## 附录 B：TS 类型总览速查

- `MessageRole`, `RunStatus`, `StepType`, `ToolCallStatus`
- `ContentBlock`, `Message`
- `ToolCall`, `ToolMeta`
- `TokenUsage`, `BaseStep`, `ToolCallStep`, `AnswerStep`, `Step`
- `Run`, `Session`
- `RunEvent`（14 种）

---

**文档结束。任何实现与本文件冲突，以本文件为准；若发现本文件有误，先更新本文件再改实现。**
```

---

这份 SPEC 已经可以直接放进仓库根目录。**进 Trae 的第一句话建议**：

> 请先阅读根目录的 `SPEC.md`，然后按照 M1 里程碑帮我搭建项目骨架。先只做 M1，完成后停下来等我确认。

这样 Trae 不会一次生成一大堆，你能逐里程碑验证。卡住的话回来找我，我们继续讨论具体的实现细节。
```