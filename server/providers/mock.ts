// Mock LLM Provider：根据用户输入关键词决定行为
// M2 支持：纯文本 / 单次工具调用 / 多次工具调用 / 工具失败

export interface ToolCallRequest {
  name: string
  args: Record<string, unknown>
}

export interface MockLLMResponse {
  text: string
  toolCalls: ToolCallRequest[]
}

export async function mockLLM(
  content: string,
  round: number,
  toolResults: Array<{ toolCallId: string; name: string; result: unknown }>,
): Promise<MockLLMResponse> {
  const lower = content.toLowerCase()

  // ── 第 2 轮及以后：根据上一轮工具结果生成最终回答 ──────────
  if (round >= 2) {
    const summary = toolResults
      .map((tr) => {
        const r = tr.result as Record<string, unknown>
        return `工具 ${tr.name} 返回：${JSON.stringify(r).slice(0, 100)}`
      })
      .join('\n')
    return {
      text: `已完成工具调用，结果如下：\n${summary}\n\n以上是本次工具调用的结果汇总。`,
      toolCalls: [],
    }
  }

  // ── 第 1 轮：根据关键词决定行为 ──────────────────────────

  // 工具执行失败场景
  if (lower.includes('fail')) {
    return {
      text: '好的，我来尝试执行一个会失败的操作。',
      toolCalls: [{ name: 'nonexistent_tool', args: { foo: 'bar' } }],
    }
  }

  // 单次工具调用：查询天气
  if (lower.includes('weather') || lower.includes('天气')) {
    const cityMatch = content.match(/(?:weather|天气)[^\u4e00-\u9fa5a-zA-Z]*([\u4e00-\u9fa5a-zA-Z]+)/)
    const city = cityMatch?.[1] || '北京'
    return {
      text: `我来帮你查询${city}的天气。`,
      toolCalls: [{ name: 'get_weather', args: { city } }],
    }
  }

  // 多次工具调用：连续 3 次
  if (lower.includes('multi')) {
    return {
      text: '我需要连续调用多个工具来完成这个任务。',
      toolCalls: [
        { name: 'get_weather', args: { city: '上海' } },
        { name: 'search_web', args: { query: 'Vue3 SSE' } },
        { name: 'calculate', args: { expression: '2 + 3 * 4' } },
      ],
    }
  }

  // 危险工具：触发数据库查询（需审批）
  if (lower.includes('db') || lower.includes('数据库')) {
    return {
      text: '检测到涉及数据库的操作，我需要先查询用户信息。',
      toolCalls: [{ name: 'db_query', args: { sql: "SELECT * FROM users WHERE role = 'admin'" } }],
    }
  }

  // 默认：纯文本回答（M1 行为）
  return {
    text: `你说了"${content}"。这是 mock 模型的纯文本回复，用于 M1 闭环验证。`,
    toolCalls: [],
  }
}
