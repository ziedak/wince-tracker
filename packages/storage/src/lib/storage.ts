// ===========================================================================
// IStore — common interface for all storage strategies
// ===========================================================================

export interface IStore {
  readonly isAvailable: boolean;
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  clear(prefix?: string): void;
  /** Force all pending writes immediately (e.g. on pagehide). Optional. */
  flush?(): void;
}

// ===========================================================================
// Helpers
// ===========================================================================

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function deserialize(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return raw; }
}

// ===========================================================================
// MemoryStore — in-memory fallback, never persists across page loads
// ===========================================================================

export class MemoryStore implements IStore {
  readonly isAvailable = true;
  private _data = new Map<string, string>();

  get(key: string): unknown {
    const raw = this._data.get(key);
    return raw === undefined ? undefined : deserialize(raw);
  }

  set(key: string, value: unknown): void {
    this._data.set(key, serialize(value));
  }

  delete(key: string): void {
    this._data.delete(key);
  }

  clear(prefix?: string): void {
    if (!prefix) { this._data.clear(); return; }
    for (const k of this._data.keys()) {
      if (k.startsWith(prefix)) this._data.delete(k);
    }
  }
}

// ===========================================================================
// LocalStore — wraps localStorage
// ===========================================================================

export interface LocalStoreOptions {
  /** Write debounce window (ms). Writes are batched within this window
   *  and flushed in one synchronous pass. Default: 16. */
  debounceMs?: number;
}

export class LocalStore implements IStore {
  readonly isAvailable: boolean;
  private readonly _debounceMs: number;
  private readonly _pending = new Map<string, string>();
  private _flushTimer?: ReturnType<typeof setTimeout>;

  constructor(opts: LocalStoreOptions = {}) {
    this._debounceMs = opts.debounceMs ?? 16;
    this.isAvailable = this._probe();
  }

  private _probe(): boolean {
    try {
      const k = '__wince_probe__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }

  get(key: string): unknown {
    // In-flight pending writes take priority for read coherence.
    if (this._pending.has(key)) return deserialize(this._pending.get(key)!);
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? undefined : deserialize(raw);
    } catch { return undefined; }
  }

  set(key: string, value: unknown): void {
    this._pending.set(key, serialize(value));
    this._armFlush();
  }

  delete(key: string): void {
    this._pending.delete(key);
    try { localStorage.removeItem(key); } catch { /* swallow */ }
  }

  /**
   * Atomic read–modify–write. Bypasses the debounce buffer so the write
   * lands in `localStorage` immediately — required for cross-tab safety
   * on fields like `lastActiveAt`.
   */
  refreshKey(key: string, updater: (current: string | null) => string): void {
    try {
      // Respect any in-flight write for this key before reading.
      const current = this._pending.get(key) ?? localStorage.getItem(key);
      const next = updater(current);
      this._pending.delete(key); // cancel any debounced write for this key
      localStorage.setItem(key, next);
    } catch { /* quota / unavailable */ }
  }

  /** Force all pending writes to localStorage immediately (call on pagehide). */
  flush(): void {
    if (this._flushTimer !== undefined) {
      clearTimeout(this._flushTimer);
      this._flushTimer = undefined;
    }
    this._flushNow();
  }

  clear(prefix?: string): void {
    if (!prefix) {
      this._pending.clear();
    } else {
      for (const k of this._pending.keys()) {
        if (k.startsWith(prefix)) this._pending.delete(k);
      }
    }
    try {
      if (!prefix) { localStorage.clear(); return; }
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch { /* swallow */ }
  }

  private _armFlush(): void {
    if (this._flushTimer !== undefined) return;
    this._flushTimer = setTimeout(() => this._flushNow(), this._debounceMs);
  }

  private _flushNow(): void {
    this._flushTimer = undefined;
    for (const [key, value] of this._pending) {
      try {
        if (localStorage.getItem(key) !== value) localStorage.setItem(key, value);
      } catch { /* quota */ }
    }
    this._pending.clear();
  }
}

// ===========================================================================
// SessionStore — wraps sessionStorage (tab-scoped)
// ===========================================================================

export interface SessionStoreOptions {
  /** Write debounce window (ms). Default: 16. */
  debounceMs?: number;
}

export class SessionStore implements IStore {
  readonly isAvailable: boolean;
  private readonly _debounceMs: number;
  private readonly _pending = new Map<string, string>();
  private _flushTimer?: ReturnType<typeof setTimeout>;

  constructor(opts: SessionStoreOptions = {}) {
    this._debounceMs = opts.debounceMs ?? 16;
    this.isAvailable = this._probe();
  }

  private _probe(): boolean {
    try {
      const k = '__wince_probe__';
      sessionStorage.setItem(k, '1');
      sessionStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }

  get(key: string): unknown {
    if (this._pending.has(key)) return deserialize(this._pending.get(key)!);
    try {
      const raw = sessionStorage.getItem(key);
      return raw === null ? undefined : deserialize(raw);
    } catch { return undefined; }
  }

  set(key: string, value: unknown): void {
    this._pending.set(key, serialize(value));
    this._armFlush();
  }

  delete(key: string): void {
    this._pending.delete(key);
    try { sessionStorage.removeItem(key); } catch { /* swallow */ }
  }

  /** Force all pending writes to sessionStorage immediately. */
  flush(): void {
    if (this._flushTimer !== undefined) {
      clearTimeout(this._flushTimer);
      this._flushTimer = undefined;
    }
    this._flushNow();
  }

  clear(prefix?: string): void {
    if (!prefix) {
      this._pending.clear();
    } else {
      for (const k of this._pending.keys()) {
        if (k.startsWith(prefix)) this._pending.delete(k);
      }
    }
    try {
      if (!prefix) { sessionStorage.clear(); return; }
      const keys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(prefix)) keys.push(k);
      }
      keys.forEach((k) => sessionStorage.removeItem(k));
    } catch { /* swallow */ }
  }

  private _armFlush(): void {
    if (this._flushTimer !== undefined) return;
    this._flushTimer = setTimeout(() => this._flushNow(), this._debounceMs);
  }

  private _flushNow(): void {
    this._flushTimer = undefined;
    for (const [key, value] of this._pending) {
      try {
        if (sessionStorage.getItem(key) !== value) sessionStorage.setItem(key, value);
      } catch { /* quota */ }
    }
    this._pending.clear();
  }
}

// ===========================================================================
// CookieStore — for cross-subdomain identity (anonymous ID, consent flag)
// ===========================================================================

export interface CookieStoreOptions {
  /** Default: true — sets cookie on the registrable root domain (e.g. .mystore.com) */
  crossSubdomain?: boolean;
  /** Default: true when page served over HTTPS */
  secure?: boolean;
  /** Default: 'Lax' */
  sameSite?: 'Lax' | 'Strict' | 'None';
  /** Default: 365 */
  maxAgeDays?: number;
}

// Module-level cache so root-domain discovery runs once per page load.
let _cachedRootDomain: string | null = null;

/**
 * Auto-discover the registrable root domain by iteratively trying to set a
 * cookie on progressively shorter subdomains. Browsers reject public suffixes
 * (.com, .co.uk), so the first subdomain they accept is the root.
 *
 * Adapted from PostHog's seekFirstNonPublicSubDomain.
 */
export function getRootDomain(hostname: string): string {
  if (_cachedRootDomain !== null) return _cachedRootDomain;
  if (!hostname || ['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    _cachedRootDomain = '';
    return '';
  }
  if (typeof document === 'undefined') {
    _cachedRootDomain = '';
    return '';
  }

  const parts = hostname.split('.');
  const probe  = '__wince_dm__';

  let found = '';
  let len   = Math.min(parts.length, 8); // paranoia cap

  while (!found && len--) {
    const candidate = parts.slice(len).join('.');
    const val = `${probe}=1;domain=.${candidate};path=/;max-age=3`;
    document.cookie = val;
    if (document.cookie.includes(probe)) {
      // Browser accepted — remove test cookie and record result
      document.cookie = `${probe}=;domain=.${candidate};path=/;max-age=0`;
      found = candidate;
    }
  }

  _cachedRootDomain = found;
  return found;
}

/** Reset the cached root domain (used in tests). */
export function resetRootDomainCache(): void {
  _cachedRootDomain = null;
}

export class CookieStore implements IStore {
  readonly isAvailable: boolean;
  private readonly _opts: Required<CookieStoreOptions>;

  constructor(opts: CookieStoreOptions = {}) {
    this._opts = {
      crossSubdomain: opts.crossSubdomain ?? true,
      secure:         opts.secure         ?? (typeof location !== 'undefined' && location.protocol === 'https:'),
      sameSite:       opts.sameSite       ?? 'Lax',
      maxAgeDays:     opts.maxAgeDays     ?? 365,
    };
    this.isAvailable = typeof document !== 'undefined' && typeof document.cookie === 'string';
  }

  get(key: string): unknown {
    if (!this.isAvailable) return undefined;
    const prefix = key + '=';
    for (const part of document.cookie.split(';')) {
      const s = part.trimStart();
      if (s.startsWith(prefix)) {
        try { return deserialize(decodeURIComponent(s.slice(prefix.length))); } catch { return undefined; }
      }
    }
    return undefined;
  }

  set(key: string, value: unknown): void {
    if (!this.isAvailable) return;
    const { crossSubdomain, secure, sameSite, maxAgeDays } = this._opts;
    const maxAge   = maxAgeDays * 24 * 60 * 60;
    const domain   = crossSubdomain
      ? getRootDomain(location.hostname)
      : '';
    const domainPart = domain ? `;domain=.${domain}` : '';
    const securePart = secure ? ';Secure' : '';

    document.cookie =
      `${key}=${encodeURIComponent(serialize(value))};max-age=${maxAge};path=/${domainPart};SameSite=${sameSite}${securePart}`;
  }

  delete(key: string): void {
    if (!this.isAvailable) return;
    const { crossSubdomain, secure, sameSite } = this._opts;
    const domain     = crossSubdomain ? getRootDomain(location.hostname) : '';
    const domainPart = domain ? `;domain=.${domain}` : '';
    const securePart = secure ? ';Secure' : '';
    // Expire on root domain AND current host to clean up old cookies
    document.cookie = `${key}=;max-age=0;path=/${domainPart};SameSite=${sameSite}${securePart}`;
    document.cookie = `${key}=;max-age=0;path=/;SameSite=${sameSite}${securePart}`;
  }

  clear(prefix?: string): void {
    if (!this.isAvailable) return;
    for (const part of document.cookie.split(';')) {
      const name = part.trimStart().split('=')[0];
      if (!prefix || name.startsWith(prefix)) this.delete(name);
    }
  }
}

// ===========================================================================
// createStore — picks the best available strategy from a priority list
// ===========================================================================

export type StoreKind = 'localStorage' | 'sessionStorage' | 'cookie' | 'memory';

export interface CreateStoreOptions {
  strategies?: StoreKind[];
  cookieOptions?: CookieStoreOptions;
}

export function createStore(opts: CreateStoreOptions = {}): IStore {
  const order = opts.strategies ?? ['localStorage', 'memory'];

  for (const kind of order) {
    let store: IStore;

    switch (kind) {
      case 'localStorage':  store = new LocalStore();   break;
      case 'sessionStorage': store = new SessionStore(); break;
      case 'cookie':        store = new CookieStore(opts.cookieOptions); break;
      case 'memory':        return new MemoryStore();   // always available — end of fallback
    }

    if (store.isAvailable) return store;
  }

  return new MemoryStore();
}

// ===========================================================================
// DurableQueue — IDB-backed queue for crash-safe event delivery
// ===========================================================================

export interface PersistedEvent {
  eid:       string;        // UUID v7 — primary key
  payload:   string;        // JSON-serialised TrackEvent
  enqueuedAt: number;       // unix ms — for age-based eviction
}

const DB_NAME    = 'wince_events';
const DB_VERSION = 1;
const STORE_NAME = 'pending';
const MAX_QUEUE  = 2000;    // hard cap — oldest evicted when exceeded

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
      const os2  = tx2.objectStore(STORE_NAME);
      await new Promise<void>((resolve, reject) => {
        const countReq = os2.count();
        countReq.onerror = () => reject(countReq.error);
        countReq.onsuccess = () => {
          const count    = countReq.result;
          const overflow = count - MAX_QUEUE;
          if (overflow <= 0) { resolve(); return; }

          // Cursor sorted by enqueuedAt ascending = oldest first.
          const idx    = os2.index('enqueuedAt');
          const curReq = idx.openCursor();
          let   deleted = 0;
          curReq.onerror = () => reject(curReq.error);
          curReq.onsuccess = (e) => {
            const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
            if (!cursor || deleted >= overflow) { resolve(); return; }
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
      req.onerror   = () => reject(req.error);
    });
  }
}

