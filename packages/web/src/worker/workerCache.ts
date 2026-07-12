import { IStorage, StoreKind } from '@wince/types';

// ---------------------------------------------------------------------------
// WorkerCache
// ---------------------------------------------------------------------------
// An in-memory key-value store (MinimalStore interface) that also persists
// writes asynchronously to IndexedDB. Used by SessionManager and
// IdentityManager inside the Worker where localStorage / sessionStorage are
// unavailable.
//
// Reads are always served from the in-memory cache (O(1), synchronous).
// Writes update the cache immediately and schedule a fire-and-forget IDB put.
// On construction, call `init()` once to load all existing keys from IDB into
// the in-memory cache before the Worker starts processing messages.
// ---------------------------------------------------------------------------

const DB_NAME = 'wince_state';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

export class WorkerCache implements IStorage {
  getStrategy(): StoreKind | StoreKind[] {
    throw new Error('Method not implemented.');
  }
  isAvailable(): boolean {
    throw new Error('Method not implemented.');
  }
  refreshKey(key: string, updater: (current: string | undefined | null) => string): void {
    throw new Error('Method not implemented.');
  }
  clear(prefix?: string): void {
    throw new Error('Method not implemented.');
  }
  flush(): void {
    throw new Error('Method not implemented.');
  }
  private readonly _cache: Map<string, string> = new Map();
  private _db: IDBDatabase | null = null;

  // -------------------------------------------------------------------------
  // Async initialisation — must be awaited before using the cache
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    try {
      this._db = await this._openDb();
      const all = await this._loadAll();
      for (const [k, v] of all) {
        this._cache.set(k, v);
      }
    } catch {
      // IDB unavailable in this Worker context — fall back to memory-only.
      // All writes will be lost on page unload, but the tracker still works.
    }
  }

  // -------------------------------------------------------------------------
  // MinimalStore — synchronous (served from in-memory cache)
  // -------------------------------------------------------------------------

  get<T = string>(key: string): T | undefined {
    return this._cache.get(key) as T | undefined;
  }

  set(key: string, value: string): void {
    this._cache.set(key, value);
    if (this._db) void this._idbPut(key, value);
  }

  delete(key: string): void {
    this._cache.delete(key);
    if (this._db) void this._idbDelete(key);
  }

  // -------------------------------------------------------------------------
  // IDB helpers
  // -------------------------------------------------------------------------

  private _openDb(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB not available'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
      req.onerror = () => reject(req.error);
    });
  }

  private _loadAll(): Promise<[string, string][]> {
    return new Promise<[string, string][]>((resolve, reject) => {
      if (!this._db) {
        resolve([]);
        return;
      }
      const tx = this._db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const pairs: [string, string][] = [];
      const curReq = store.openCursor();
      curReq.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (!cursor) {
          resolve(pairs);
          return;
        }
        pairs.push([cursor.key as string, cursor.value as string]);
        cursor.continue();
      };
      curReq.onerror = () => reject(curReq.error);
    });
  }

  private _idbPut(key: string, value: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this._db) {
        resolve();
        return;
      }
      const tx = this._db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private _idbDelete(key: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this._db) {
        resolve();
        return;
      }
      const tx = this._db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}
