// ===========================================================================
// DurableQueue — IDB-backed queue for crash-safe event delivery
// ===========================================================================

export interface PersistedEvent {
  eid: string; // UUID v7 — primary key
  payload: string; // JSON-serialised TrackEvent
  enqueuedAt: number; // unix ms — for age-based eviction
}

const DB_NAME = 'wince_events';
const DB_VERSION = 1;
const STORE_NAME = 'pending';
const MAX_QUEUE = 2000; // hard cap — oldest evicted when exceeded

export class DurableQueue {
  private _ready: Promise<IDBDatabase> | null = null;

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

  private _open(): Promise<IDBDatabase> {
    if (this._ready) return this._ready;

    this._ready = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB not available'));
        return;
      }

      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        // v1 → v1: create store on first open
        // Future bumps: accept dropped events (see ARCHITECTURE.md §1)
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const os = db.createObjectStore(STORE_NAME, { keyPath: 'eid' });
          os.createIndex('enqueuedAt', 'enqueuedAt', { unique: false });
        }
      };

      req.onsuccess = (e) => {
        resolve((e.target as IDBOpenDBRequest).result);
      };

      req.onerror = () => reject(req.error);

      // Version mismatch: drop old database and start fresh
      req.onblocked = () => {
        // Another tab has an older version open — can't migrate; just reject
        reject(new Error('IndexedDB blocked by another tab'));
      };
    });

    return this._ready;
  }

  // ---------------------------------------------------------------------------
  // Write — fire-and-forget; caller does not await
  // ---------------------------------------------------------------------------

  enqueue(event: PersistedEvent): void {
    void this._enqueueAsync(event);
  }

  private async _enqueueAsync(event: PersistedEvent): Promise<void> {
    try {
      const db = await this._open();

      // Tx 1: write the event.
      const tx1 = db.transaction(STORE_NAME, 'readwrite');
      await this._idbRequest(tx1.objectStore(STORE_NAME).put(event));

      // Tx 2: check the count and evict oldest entries if over the cap.
      // All IDB requests are issued without intermediate `await` inside this
      // transaction so it stays active (no TransactionInactiveError on Safari).
      const tx2 = db.transaction(STORE_NAME, 'readwrite');
      const os2 = tx2.objectStore(STORE_NAME);
      await new Promise<void>((resolve, reject) => {
        const countReq = os2.count();
        countReq.onerror = () => reject(countReq.error);
        countReq.onsuccess = () => {
          const count = countReq.result;
          const overflow = count - MAX_QUEUE;
          if (overflow <= 0) {
            resolve();
            return;
          }

          // Cursor sorted by enqueuedAt ascending = oldest first.
          const idx = os2.index('enqueuedAt');
          const curReq = idx.openCursor();
          let deleted = 0;
          curReq.onerror = () => reject(curReq.error);
          curReq.onsuccess = (e) => {
            const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
            if (!cursor || deleted >= overflow) {
              resolve();
              return;
            }
            cursor.delete();
            deleted++;
            cursor.continue();
          };
        };
      });
    } catch {
      // IDB unavailable or quota exceeded — silently drop.
    }
  }

  // ---------------------------------------------------------------------------
  // Load pending events on startup for replay
  // ---------------------------------------------------------------------------

  async loadPending(): Promise<PersistedEvent[]> {
    try {
      const db = await this._open();
      const tx = db.transaction(STORE_NAME, 'readonly');
      const os = tx.objectStore(STORE_NAME);
      return await this._idbRequest<PersistedEvent[]>(os.getAll());
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Ack delivered events — remove from IDB
  // ---------------------------------------------------------------------------

  async ack(eids: string[]): Promise<void> {
    if (eids.length === 0) return;
    try {
      const db = await this._open();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const os = tx.objectStore(STORE_NAME);
      await Promise.all(eids.map((id) => this._idbRequest(os.delete(id))));
    } catch {
      // best-effort
    }
  }

  // ---------------------------------------------------------------------------
  // Size — resolves to current count
  // ---------------------------------------------------------------------------

  async size(): Promise<number> {
    try {
      const db = await this._open();
      const tx = db.transaction(STORE_NAME, 'readonly');
      const os = tx.objectStore(STORE_NAME);
      return await this._idbRequest<number>(os.count());
    } catch {
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Helper: promisify an IDBRequest
  // ---------------------------------------------------------------------------

  private _idbRequest<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
}
