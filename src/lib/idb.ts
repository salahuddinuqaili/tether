// Minimal promise-based IndexedDB key-value store. One object store ('kv') in a
// single database ('tether'). Deliberately dependency-free — the whole app is a
// no-backend PWA and this is the only structured on-device store we need for
// settings + the PAT (OPFS handles file buffers separately, see storage/buffers).
const DB_NAME = 'tether'
const STORE = 'kv'
const VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const store = db.transaction(STORE, mode).objectStore(STORE)
        const req = run(store)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
      }),
  )
}

export function idbGet<T>(key: string): Promise<T | undefined> {
  return tx('readonly', (s) => s.get(key) as IDBRequest<T | undefined>)
}

export function idbSet<T>(key: string, value: T): Promise<void> {
  return tx('readwrite', (s) => s.put(value, key) as IDBRequest<IDBValidKey>).then(() => undefined)
}

export function idbDelete(key: string): Promise<void> {
  return tx('readwrite', (s) => s.delete(key) as IDBRequest<undefined>).then(() => undefined)
}
