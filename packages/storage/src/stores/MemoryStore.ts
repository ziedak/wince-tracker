// ===========================================================================
// MemoryStore — in-memory fallback, never persists across page loads
// ===========================================================================

import { deserialize, IStore, serialize } from "./storage";

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
