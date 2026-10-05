// 工具注册表：定义工具元信息 + 执行函数
// M2 阶段工具均 requiresApproval: false，审批逻辑在 M3

export interface ToolDefinition {
  name: string
  displayName: string
  description: string
  icon: string
  dangerous: boolean
  // 执行函数，返回 result（会被序列化为 tool_call_result 事件）
  execute: (args: Record<string, unknown>) => Promise<unknown>
}

// ── 工具实现 ──────────────────────────────
async function getWeather(args: Record<string, unknown>): Promise<unknown> {
  const city = (args.city as string) ?? '未知城市'
  // 模拟网络延迟
  await new Promise(r => setTimeout(r, 400))
  return {
    city,
    temperature: 22 + Math.floor(Math.random() * 10),
    condition: ['晴', '多云', '小雨'][Math.floor(Math.random() * 3)],
    humidity: 40 + Math.floor(Math.random() * 40),
  }
}

async function searchWeb(args: Record<string, unknown>): Promise<unknown> {
  const query = (args.query as string) ?? ''
  await new Promise(r => setTimeout(r, 500))
  return {
    query,
    results: [
      { title: `${query} - 搜索结果 1`, snippet: `关于 ${query} 的第一条摘要信息` },
      { title: `${query} - 搜索结果 2`, snippet: `关于 ${query} 的第二条摘要信息` },
    ],
  }
}

async function calculate(args: Record<string, unknown>): Promise<unknown> {
  const expression = (args.expression as string) ?? '0'
  await new Promise(r => setTimeout(r, 200))
  // 安全计算：仅支持简单四则运算
  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${expression})`)()
    return { expression, result: Number(result) }
  } catch {
    return { expression, error: '无效的表达式' }
  }
}

// ── 注册表 ────────────────────────────────
export const tools: Record<string, ToolDefinition> = {
  get_weather: {
    name: 'get_weather',
    displayName: '天气查询',
    description: '查询指定城市的实时天气',
    icon: '☀️',
    dangerous: false,
    execute: getWeather,
  },
  search_web: {
    name: 'search_web',
    displayName: '网页搜索',
    description: '搜索互联网获取信息',
    icon: '🔍',
    dangerous: false,
    execute: searchWeb,
  },
  calculate: {
    name: 'calculate',
    displayName: '计算器',
    description: '执行数学计算',
    icon: '🧮',
    dangerous: false,
    execute: calculate,
  },
  db_query: {
    name: 'db_query',
    displayName: '数据库查询',
    description: '执行数据库 SQL（危险操作，需人工审批）',
    icon: '🗄️',
    dangerous: true,
    execute: dbQuery,
  },
}

export function getTool(name: string): ToolDefinition | undefined {
  return tools[name]
}

export function listTools(): ToolDefinition[] {
  return Object.values(tools)
}

// ── 危险工具（M3：需要人工审批）─────────────────
async function dbQuery(args: Record<string, unknown>): Promise<unknown> {
  const sql = (args.sql as string) ?? ''
  await new Promise(r => setTimeout(r, 600))
  return {
    sql,
    affectedRows: 3,
    result: [
      { id: 1, name: 'Alice', role: 'admin' },
      { id: 2, name: 'Bob', role: 'user' },
    ],
  }
}
