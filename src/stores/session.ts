import { defineStore } from 'pinia'
import type { Session } from '@/types/agent'
import { sessionRepo, messageRepo, runRepo, eventRepo } from '@/db/repo'

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    sessions: new Map<string, Session>(),
    currentSessionId: null as string | null,
    loading: false,
  }),

  getters: {
    currentSession(state): Session | null {
      return state.currentSessionId ? state.sessions.get(state.currentSessionId) ?? null : null
    },
    sessionList(state): Session[] {
      return Array.from(state.sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt)
    },
  },

  actions: {
    // 启动时从 IndexedDB 加载所有会话
    async loadAll() {
      this.loading = true
      try {
        const sessions = await sessionRepo.getAll()
        this.sessions = new Map(sessions.map((s) => [s.id, s]))
        // 默认选中最近更新的会话
        if (sessions.length > 0 && !this.currentSessionId) {
          const latest = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0]
          this.currentSessionId = latest.id
        }
      } finally {
        this.loading = false
      }
    },

    createSession(title?: string): Session {
      const now = Date.now()
      const session: Session = {
        id: genId('session'),
        title: title ?? '新会话',
        createdAt: now,
        updatedAt: now,
        messageIds: [],
        runIds: [],
        stats: { runCount: 0, toolCallCount: 0, totalTokens: 0 },
      }
      this.sessions.set(session.id, session)
      this.currentSessionId = session.id
      // 持久化
      sessionRepo.put(session)
      return session
    },

    selectSession(id: string) {
      this.currentSessionId = id
    },

    updateTitle(id: string, title: string) {
      const s = this.sessions.get(id)
      if (s) {
        s.title = title
        sessionRepo.put(s)
      }
    },

    bumpUpdatedAt(id: string) {
      const s = this.sessions.get(id)
      if (s) {
        s.updatedAt = Date.now()
        // 不立即写盘，交给 flush 节流处理（简化：直接写）
        sessionRepo.put(s)
      }
    },

    addRunId(id: string, runId: string) {
      const s = this.sessions.get(id)
      if (s && !s.runIds.includes(runId)) {
        s.runIds.push(runId)
        s.stats.runCount++
        s.updatedAt = Date.now()
        sessionRepo.put(s)
      }
    },

    addMessageId(id: string, messageId: string) {
      const s = this.sessions.get(id)
      if (s && !s.messageIds.includes(messageId)) {
        s.messageIds.push(messageId)
        s.updatedAt = Date.now()
      }
    },

    async deleteSession(id: string) {
      // 级联删除：messages / runs / events
      await Promise.all([
        messageRepo.deleteBySession(id),
        runRepo.deleteBySession(id),
        eventRepo.deleteByRun(id),
      ])
      await sessionRepo.delete(id)
      this.sessions.delete(id)
      if (this.currentSessionId === id) {
        this.currentSessionId = this.sessionList[0]?.id ?? null
      }
    },
  },
})
