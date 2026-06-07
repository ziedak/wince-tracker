// ---------------------------------------------------------------------------
// Internal doubly-linked list node
// ---------------------------------------------------------------------------

interface Node<K, V> {
  key:        K;
  value:      V;
  expiresAt:  number; // 0 = never expires
  prev:       Node<K, V> | null;
  next:       Node<K, V> | null;
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

export class LRUCache<K, V> {
  private readonly _maxSize: number;
  private readonly _ttlMs:   number;
  private readonly _map:     Map<K, Node<K, V>> = new Map();

  // Sentinel nodes for the doubly-linked list.
  // _head.next is the MRU (most recently used) node.
  // _tail.prev is the LRU (least recently used) node.
  private readonly _head: Node<K, V>;
  private readonly _tail: Node<K, V>;

  constructor(options: LRUCacheOptions) {
    if (options.maxSize < 1) throw new RangeError('LRUCache: maxSize must be >= 1');
    this._maxSize = options.maxSize;
    this._ttlMs   = options.ttlMs ?? 0;

    // Sentinels carry no real data; key/value are never read.
    this._head = { key: null as any, value: null as any, expiresAt: 0, prev: null, next: null };
    this._tail = { key: null as any, value: null as any, expiresAt: 0, prev: null, next: null };
    this._head.next = this._tail;
    this._tail.prev = this._head;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  get size(): number {
    return this._map.size;
  }

  has(key: K): boolean {
    const node = this._map.get(key);
    if (!node) return false;
    if (this._isExpired(node)) {
      this._remove(node);
      return false;
    }
    return true;
  }

  get(key: K): V | undefined {
    const node = this._map.get(key);
    if (!node) return undefined;
    if (this._isExpired(node)) {
      this._remove(node);
      return undefined;
    }
    // Move to front (MRU position)
    this._detach(node);
    this._prepend(node);
    return node.value;
  }

  set(key: K, value: V): void {
    const existing = this._map.get(key);
    if (existing) {
      existing.value     = value;
      existing.expiresAt = this._ttlMs > 0 ? Date.now() + this._ttlMs : 0;
      this._detach(existing);
      this._prepend(existing);
      return;
    }

    const node: Node<K, V> = {
      key,
      value,
      expiresAt: this._ttlMs > 0 ? Date.now() + this._ttlMs : 0,
      prev: null,
      next: null,
    };
    this._map.set(key, node);
    this._prepend(node);

    if (this._map.size > this._maxSize) {
      this._evictLRU();
    }
  }

  delete(key: K): boolean {
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

  private _isExpired(node: Node<K, V>): boolean {
    return node.expiresAt > 0 && Date.now() > node.expiresAt;
  }

  /** Detach `node` from the list without removing from the map. */
  private _detach(node: Node<K, V>): void {
    node.prev!.next = node.next;
    node.next!.prev = node.prev;
  }

  /** Insert `node` at the front of the list (MRU position). */
  private _prepend(node: Node<K, V>): void {
    node.next        = this._head.next;
    node.prev        = this._head;
    this._head.next! .prev = node;
    this._head.next  = node;
  }

  /** Remove `node` from both the list and the map. */
  private _remove(node: Node<K, V>): void {
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

