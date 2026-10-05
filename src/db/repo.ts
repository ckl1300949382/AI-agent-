import { openDB, type EventRecord } from './schema'
import type { Session, Message, Run } from '@/types/agent'
import type { RunEvent } from '@/types/events'

// 通用：在指定 store 上执行一个写操作
function write<T>(storeName: string, value: T): Promise<void> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite')
      tx.objectStore(storeName).put(value)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  })
}

// 通用：批量写入
function writeBatch<T>(storeName: string, values: T[]): Promise<void> {
  if (values.length === 0) return Promise.resolve()
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite')
      const store = tx.objectStore(storeName)
      for (const v of values) store.put(v)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  })
}

// 通用：按 keyPath 读取单条
function getByKey<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly')
      const req = tx.objectStore(storeName).get(key)
      req.onsuccess = () => resolve(req.result as T | undefined)
      req.onerror = () => reject(req.error)
    })
  })
}

// 通用：读取 store 全部
function getAll<T>(storeName: string): Promise<T[]> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly')
      const req = tx.objectStore(storeName).getAll()
      req.onsuccess = () => resolve(req.result as T[])
      req.onerror = () => reject(req.error)
    })
  })
}

// 通用：按索引读取
function getByIndex<T>(storeName: string, indexName: string, value: IDBValidKey): Promise<T[]> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly')
      const req = tx.objectStore(storeName).index(indexName).getAll(value)
      req.onsuccess = () => resolve(req.result as T[])
      req.onerror = () => reject(req.error)
    })
  })
}

// 通用：按 key 删除
function deleteByKey(storeName: string, key: IDBValidKey): Promise<void> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite')
      tx.objectStore(storeName).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  })
}

// 通用：按索引删除所有匹配
function deleteByIndex(storeName: string, indexName: string, value: IDBValidKey): Promise<void> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite')
      const store = tx.objectStore(storeName)
      const idx = store.index(indexName)
      const req = idx.openCursor(value)
      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  })
}

// ── sessions ──────────────────────────────
export const sessionRepo = {
  put: (s: Session) => write('sessions', s),
  get: (id: string) => getByKey<Session>('sessions', id),
  getAll: () => getAll<Session>('sessions'),
  delete: (id: string) => deleteByKey('sessions', id),
}

// ── messages ──────────────────────────────
export const messageRepo = {
  put: (m: Message) => write('messages', m),
  putBatch: (msgs: Message[]) => writeBatch('messages', msgs),
  getBySession: (sessionId: string) =>
    getByIndex<Message>('messages', 'sessionId', sessionId),
  deleteBySession: (sessionId: string) =>
    deleteByIndex('messages', 'sessionId', sessionId),
}

// ── runs ──────────────────────────────────
export const runRepo = {
  put: (r: Run) => write('runs', r),
  putBatch: (runs: Run[]) => writeBatch('runs', runs),
  getAll: () => getAll<Run>('runs'),
  getBySession: (sessionId: string) =>
    getByIndex<Run>('runs', 'sessionId', sessionId),
  deleteBySession: (sessionId: string) =>
    deleteByIndex('runs', 'sessionId', sessionId),
}

// ── events ────────────────────────────────
export const eventRepo = {
  // 批量写入事件，seq 用数组下标
  putBatch: (runId: string, events: RunEvent[]) => {
    const records: EventRecord[] = events.map((data, i) => ({
      runId,
      seq: i + 1,
      data,
    }))
    return writeBatch('events', records)
  },
  getByRun: async (runId: string): Promise<RunEvent[]> => {
    const records = await getByIndex<EventRecord>('events', 'runId', runId)
    return records
      .sort((a, b) => a.seq - b.seq)
      .map((r) => r.data)
  },
  deleteByRun: (runId: string) => deleteByIndex('events', 'runId', runId),
}
