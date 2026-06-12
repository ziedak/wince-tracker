// ===========================================================================
// SessionStore — wraps sessionStorage (tab-scoped)
// ===========================================================================

import { deserialize, IStore, serialize } from './storage';

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
    if (this._pending.has(key)) {
      const pendingValue = this._pending.get(key);
      if (pendingValue !== undefined) {
        return deserialize(pendingValue);
      }
    }
    try {
      const raw = sessionStorage.getItem(key);
      return raw === null ? undefined : deserialize(raw);
    } catch {
      return undefined;
    }
  }

  set(key: string, value: unknown): void {
    this._pending.set(key, serialize(value));
    this._armFlush();
  }

  delete(key: string): void {
    this._pending.delete(key);
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* swallow */
    }
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
      if (!prefix) {
        sessionStorage.clear();
        return;
      }
      const keys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(prefix)) keys.push(k);
      }
      keys.forEach((k) => sessionStorage.removeItem(k));
    } catch {
      /* swallow */
    }
  }

  private _armFlush(): void {
    if (this._flushTimer !== undefined) return;
    this._flushTimer = setTimeout(() => this._flushNow(), this._debounceMs);
  }

  private _flushNow(): void {
    this._flushTimer = undefined;
    for (const [key, value] of this._pending) {
      try {
        if (sessionStorage.getItem(key) !== value)
          sessionStorage.setItem(key, value);
      } catch {
        /* quota */
      }
    }
    this._pending.clear();
  }
}
