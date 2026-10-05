import type { Session, Message, Run } from '@/types/agent'
import type { RunEvent } from '@/types/events'

const DB_NAME = 'agent-console'
const DB_VERSION = 1

// 事件表的记录：runId + seq 作为复合主键
export interface EventRecord {
  runId: string
  seq: number
  data: RunEvent
}

let dbPromise: Promise<IDBDatabase> | null = null

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result

      // sessions：会话元信息
      if (!db.objectStoreNames.contains('sessions')) {
        const store = db.createObjectStore('sessions', { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt')
      }

      // messages：消息体
      if (!db.objectStoreNames.contains('messages')) {
        const store = db.createObjectStore('messages', { keyPath: 'id' })
        store.createIndex('sessionId', 'sessionId')
        store.createIndex('createdAt', 'createdAt')
      }

      // runs：运行元信息（不含 events）
      if (!db.objectStoreNames.contains('runs')) {
        const store = db.createObjectStore('runs', { keyPath: 'id' })
        store.createIndex('sessionId', 'sessionId')
        store.createIndex('startedAt', 'startedAt')
      }

      // events：事件流，复合主键 [runId, seq]
      if (!db.objectStoreNames.contains('events')) {
        const store = db.createObjectStore('events', { keyPath: ['runId', 'seq'] })
        store.createIndex('runId', 'runId')
      }
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

  return dbPromise
}

// 类型别名，方便 repo 引用
export type { Session, Message, Run, RunEvent }
