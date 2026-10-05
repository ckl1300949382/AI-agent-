// 取消标记：runner 在每个检查点查看 runId 是否被标记
// POST /api/runs/:runId/cancel 会把 runId 加入此集合

const cancelled = new Set<string>()

export function markCancelled(runId: string) {
    cancelled.add(runId)
}

export function isCancelled(runId: string): boolean {
    return cancelled.has(runId)
}

export function clearCancelled(runId: string) {
    cancelled.delete(runId)
}
