import {deserialize, serialize, IStore } from "./storage";

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