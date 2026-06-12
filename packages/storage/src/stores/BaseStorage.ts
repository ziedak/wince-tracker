import { deserialize } from '../utils';

export interface IStore {
  isAvailable(): boolean;
  refreshKey(
    key: string,
    updater: (current: string | undefined | null) => string,
  ): void;
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  clear(prefix?: string): void;
  /** Force all pending writes immediately (e.g. on pagehide). Optional. */
  flush(): void;
}
export class BaseStorage implements IStore {
  protected _data: Map<string, string> = new Map();
  private _flushTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private storage?: Storage,
    private readonly _debounceMs = 16,
  ) {}

  isAvailable(): boolean {
    if (!this.storage) return true; // MemoryStore fallback is always available
    try {
      const k = '__wince_probe__';
      this.storage.setItem(k, '1');
      this.storage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }
  get<T>(key: string): T | undefined {
    // In-flight_data writes take priority for read coherence.
    if (this._data.has(key)) {
      const pendingValue = this._data.get(key);
      if (pendingValue !== undefined) {
        return deserialize<T>(pendingValue) as T;
      }
    }
    try {
      if (!this.storage) return undefined;
      const raw = this.storage.getItem(key);
      return raw === null ? undefined : (deserialize<T>(raw) as T);
    } catch {
      return undefined;
    }
  }
  delete(key: string): void {
    this._data.delete(key);
    try {
      this.storage?.removeItem(key);
    } catch {
      /* swallow */
    }
  }
  set(key: string, value: unknown): void {
    this._data.set(key, JSON.stringify(value));
    try {
      if (this.storage) this._armFlush();
    } catch {
      /* swallow */
    }
  }

  clear(prefix?: string): void {
    if (!prefix) {
      this._data.clear();
      if (this.storage) this.storage.clear();
      return;
    } else {
      for (const k of this._data.keys()) {
        if (k.startsWith(prefix)) {
          this._data.delete(k);
        }
      }
      if (this.storage && this.storage.length > 0) {
        for (let i = 0; i < this.storage.length; i++) {
          const k = this.storage.key(i);
          if (k && k.startsWith(prefix)) this.storage.removeItem(k);
        }
      }
    }
  }
  flush(): void {
    if (this._flushTimer !== undefined) {
      clearTimeout(this._flushTimer);
      this._flushTimer = undefined;
    }
    this._flushNow();
  }

  /**
   * Atomic read–modify–write. Bypasses the debounce buffer so the write
   * lands in `localStorage` immediately — required for cross-tab safety
   * on fields like `lastActiveAt`.
   */
  refreshKey(
    key: string,
    updater: (current: string | undefined | null) => string,
  ): void {
    try {
      // Respect any in-flight write for this key before reading.
      const current = this._data.get(key) ?? this.storage?.getItem(key);
      const next = updater(current);
      this._data.delete(key); // cancel any debounced write for this key
      this.storage?.setItem(key, next);
    } catch {
      /* quota / unavailable */
    }
  }

  private _armFlush(): void {
    if (this._flushTimer !== undefined) return;
    this._flushTimer = setTimeout(() => this._flushNow(), this._debounceMs);
  }

  private _flushNow(): void {
    this._flushTimer = undefined;
    for (const [key, value] of this._data) {
      try {
        if (this.storage && this.storage.getItem(key) !== value)
          this.storage.setItem(key, value);
      } catch {
        /* quota */
      }
    }
    this._data.clear();
  }
}
