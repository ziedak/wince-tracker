import { LRUCache } from "../src/cache.js";

describe('LRUCache', () => {
  describe('basic get/set/has/delete', () => {
    it('stores and retrieves a value', () => {
      const c = new LRUCache({ maxSize: 3 });
      c.set('a', 1);
      expect(c.get('a')).toBe(1);
    });

    it('returns undefined for missing keys', () => {
      const c = new LRUCache({ maxSize: 3 });
      expect(c.get('x')).toBeUndefined();
    });

    it('has() returns true for existing, false for missing', () => {
      const c = new LRUCache({ maxSize: 3 });
      c.set('a', 1);
      expect(c.has('a')).toBe(true);
      expect(c.has('b')).toBe(false);
    });

    it('delete() removes the entry', () => {
      const c = new LRUCache({ maxSize: 3 });
      c.set('a', 1);
      expect(c.delete('a')).toBe(true);
      expect(c.has('a')).toBe(false);
      expect(c.delete('a')).toBe(false); // already gone
    });

    it('clear() empties the cache', () => {
      const c = new LRUCache({ maxSize: 3 });
      c.set('a', 1);
      c.set('b', 2);
      c.clear();
      expect(c.size).toBe(0);
      expect(c.get('a')).toBeUndefined();
    });

    it('size reflects entry count', () => {
      const c = new LRUCache({ maxSize: 5 });
      expect(c.size).toBe(0);
      c.set('a', 1);
      c.set('b', 2);
      expect(c.size).toBe(2);
      c.delete('a');
      expect(c.size).toBe(1);
    });

    it('overwriting a key updates value and moves to MRU', () => {
      const c = new LRUCache({ maxSize: 2 });
      c.set('a', 1);
      c.set('b', 2);
      c.set('a', 99); // update — a is now MRU
      c.set('c', 3);  // evicts b (LRU)
      expect(c.has('a')).toBe(true);
      expect(c.get('a')).toBe(99);
      expect(c.has('b')).toBe(false);
    });
  });

  describe('LRU eviction', () => {
    it('evicts the least-recently-used entry when full', () => {
      const c = new LRUCache({ maxSize: 3 });
      c.set('a', 1);
      c.set('b', 2);
      c.set('c', 3);
      c.set('d', 4); // a is LRU → evicted
      expect(c.has('a')).toBe(false);
      expect(c.has('b')).toBe(true);
      expect(c.has('c')).toBe(true);
      expect(c.has('d')).toBe(true);
    });

    it('get() promotes an entry so it is not evicted', () => {
      const c = new LRUCache({ maxSize: 3 });
      c.set('a', 1);
      c.set('b', 2);
      c.set('c', 3);
      c.get('a');     // a is now MRU; b becomes LRU
      c.set('d', 4); // b evicted
      expect(c.has('a')).toBe(true);
      expect(c.has('b')).toBe(false);
    });

    it('evicts in FIFO order when nothing is accessed', () => {
      const c = new LRUCache({ maxSize: 2 });
      c.set('a', 1);
      c.set('b', 2);
      c.set('c', 3); // a evicted
      c.set('d', 4); // b evicted
      expect(c.has('a')).toBe(false);
      expect(c.has('b')).toBe(false);
      expect(c.has('c')).toBe(true);
      expect(c.has('d')).toBe(true);
    });

    it('maxSize=1 always keeps only the latest entry', () => {
      const c = new LRUCache({ maxSize: 1 });
      c.set('a', 1);
      c.set('b', 2);
      expect(c.has('a')).toBe(false);
      expect(c.get('b')).toBe(2);
    });

    it('throws if maxSize < 1', () => {
      expect(() => new LRUCache({ maxSize: 0 })).toThrow(RangeError);
    });
  });

  describe('TTL expiry', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('entry is accessible before TTL expires', () => {
      const c = new LRUCache({ maxSize: 3, ttlMs: 1000 });
      c.set('a', 1);
      jest.advanceTimersByTime(999);
      expect(c.get('a')).toBe(1);
    });

    it('get() returns undefined after TTL expires', () => {
      const c = new LRUCache({ maxSize: 3, ttlMs: 1000 });
      c.set('a', 1);
      jest.advanceTimersByTime(1001);
      expect(c.get('a')).toBeUndefined();
    });

    it('has() returns false after TTL expires', () => {
      const c = new LRUCache({ maxSize: 3, ttlMs: 500 });
      c.set('a', 1);
      jest.advanceTimersByTime(501);
      expect(c.has('a')).toBe(false);
    });

    it('set() refreshes TTL on existing key', () => {
      const c = new LRUCache({ maxSize: 3, ttlMs: 1000 });
      c.set('a', 1);
      jest.advanceTimersByTime(800);
      c.set('a', 2); // refresh
      jest.advanceTimersByTime(800); // total 1600ms but TTL reset at 800ms
      expect(c.get('a')).toBe(2);
    });

    it('expired entry is removed from size count', () => {
      const c = new LRUCache({ maxSize: 3, ttlMs: 100 });
      c.set('a', 1);
      expect(c.size).toBe(1);
      jest.advanceTimersByTime(101);
      c.get('a'); // triggers removal
      expect(c.size).toBe(0);
    });
  });
});
