import type { ILRUCache } from '@wince/types';
// ---------------------------------------------------------------------------
// Internal doubly-linked list node
// ---------------------------------------------------------------------------

interface Node<K, V> {
  key: K;
  value: V;
  expiresAt: number; // 0 = never expires
  prev: Node<K, V> | null;
  next: Node<K, V> | null;
}

// ---------------------------------------------------------------------------
// LRUCache
// ---------------------------------------------------------------------------

export interface LRUCacheOptions {
  /** Maximum number of entries before the least-recently-used one is evicted. */
  maxSize: number;
  /**
   * Optional time-to-live in milliseconds. Entries expire this long after
   * being `set`, regardless of access. 0 or omitted = never expires.
   */
  ttlMs?: number;
}


export class LRUCache implements ILRUCache   {
  private readonly _maxSize: number;
  private readonly _ttlMs: number;
  private readonly _map: Map<string, Node<string, string>> = new Map();

  // Sentinel nodes for the doubly-linked list.
  // _head.next is the MRU (most recently used) node.
  // _tail.prev is the LRU (least recently used) node.
  private readonly _head: Node<string, string>;
  private readonly _tail: Node<string, string>;

  constructor(options: LRUCacheOptions) {
    if (options.maxSize < 1) throw new RangeError('LRUCache: maxSize must be >= 1');
    this._maxSize = options.maxSize;
    this._ttlMs = options.ttlMs ?? 0;

    // Sentinels carry no real data; key/value are never read.
    this._head = { key: '', value: '', expiresAt: 0, prev: null, next: null };
    this._tail = { key: '', value: '', expiresAt: 0, prev: null, next: null };
    this._head.next = this._tail;
    this._tail.prev = this._head;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  get size(): number {
    return this._map.size;
  }

  has(key: string): boolean {
    const node = this._map.get(key);
    if (!node) return false;
    if (this._isExpired(node)) {
      this._remove(node);
      return false;
    }
    return true;
  }

  get<T>(key: string): T | undefined {
    const node = this._map.get(key);
    if (!node) return undefined;
    if (this._isExpired(node)) {
      this._remove(node);
      return undefined;
    }
    // Move to front (MRU position)
    this._detach(node);
    this._prepend(node);
    return JSON.parse(node.value) as T;
  }
  private _toString<T>(value: T): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  set<T>(key: string, value: T): void {
    const existing = this._map.get(key);
    if (existing) {
      const strValue = this._toString(value);
      existing.value = strValue;
      existing.expiresAt = this._ttlMs > 0 ? Date.now() + this._ttlMs : 0;
      this._detach(existing);
      this._prepend(existing);
      return;
    }

    const node: Node<string, string> = {
      key,
      value: this._toString(value),
      expiresAt: this._ttlMs > 0 ? Date.now() + this._ttlMs : 0,
      prev: null,
      next: null
    };
    this._map.set(key, node);
    this._prepend(node);

    if (this._map.size > this._maxSize) {
      this._evictLRU();
    }
  }

  delete(key: string): boolean {
    const node = this._map.get(key);
    if (!node) return false;
    this._remove(node);
    return true;
  }

  clear(): void {
    this._map.clear();
    this._head.next = this._tail;
    this._tail.prev = this._head;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private _isExpired(node: Node<string, string>): boolean {
    return node.expiresAt > 0 && Date.now() > node.expiresAt;
  }

  /** Detach `node` from the list without removing from the map. */
  private _detach(node: Node<string, string>): void {
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
  }

  /** Insert `node` at the front of the list (MRU position). */
  private _prepend(node: Node<string, string>): void {
    node.next = this._head.next;
    node.prev = this._head;
    if (this._head.next) this._head.next.prev = node;
    this._head.next = node;
  }

  /** Remove `node` from both the list and the map. */
  private _remove(node: Node<string, string>): void {
    this._detach(node);
    this._map.delete(node.key);
  }

  /** Evict the least-recently-used entry (back of the list). */
  private _evictLRU(): void {
    const lru = this._tail.prev;
    if (lru && lru !== this._head) {
      this._remove(lru);
    }
  }
}
