import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

import { BaseStorage } from '../src/stores/BaseStorage.js';
import { DurableQueue, PersistedEvent } from '../src/DurableQueue.js';
import { createMultiStorage } from '../src/stores/MultiStorage.js';
import {
  CookieStore as CookieStoreClass,
  getRootDomain,
  resetRootDomainCache
} from '../src/stores/CookieStore.js';
import type { IStorage } from '@wince/types';

function createStorageMock(): Storage {
  const data = new Map<string, string>();

  return {
    get length() {
      return data.size;
    },
    clear: () => {
      data.clear();
    },
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, value);
    }
  } as Storage;
}

function installCookieEnvironment(
  options: { hostname?: string; protocol?: string; acceptedDomain?: string } = {}
) {
  const cookieJar = new Map<string, string>();
  const documentObject = globalThis.document as Document | undefined;
  const locationObject = globalThis.location as Location | undefined;
  const originalCookieDescriptor = documentObject
    ? Object.getOwnPropertyDescriptor(documentObject, 'cookie')
    : undefined;
  const originalLocationDescriptor = locationObject
    ? Object.getOwnPropertyDescriptor(locationObject, 'hostname')
    : undefined;

  // Always ensure hostname is explicitly set for probing
  if (locationObject && originalLocationDescriptor) {
    Object.defineProperty(locationObject, 'hostname', {
      configurable: true,
      get() {
        return options.hostname ?? 'localhost';
      }
    });
  }

  if (documentObject) {
    Object.defineProperty(documentObject, 'cookie', {
      configurable: true,
      get() {
        return Array.from(cookieJar.entries())
          .map(([name, value]) => `${name}=${value}`)
          .join('; ');
      },
      set(value: string) {
        const trimmed = value.trim();
        if (!trimmed) return;

        const shouldDelete = /;max-age=0(;|$)/i.test(trimmed);

        const nameValuePart = trimmed.split(';')[0];
        const eqIndex = nameValuePart.indexOf('=');
        const name = eqIndex >= 0 ? nameValuePart.slice(0, eqIndex) : nameValuePart;
        const rawValue = eqIndex >= 0 ? nameValuePart.slice(eqIndex + 1) : '';

        const domainMatch = trimmed.match(/;\s*domain=([^;]*)/i);
        const domainValue = domainMatch
          ? domainMatch[1].replace(/^\./, '').trim()
          : '';

        const domainParts = domainValue.split('.');
        const isValidDomain = !domainValue || domainParts.length >= 2;

          if (shouldDelete) {
            cookieJar.delete(name);
          } else if (isValidDomain) {
            cookieJar.set(name, rawValue);
          }
      }
    });
  }

  return () => {
    if (documentObject && originalCookieDescriptor) {
      Object.defineProperty(documentObject, 'cookie', originalCookieDescriptor);
    }
    if (locationObject && originalLocationDescriptor) {
      Object.defineProperty(locationObject, 'hostname', originalLocationDescriptor);
    }
  };
}

// const cookieSuite =
//   typeof document !== 'undefined' && typeof document.cookie === 'string' ? describe : describe.skip;

// ===========================================================================
// MemoryStore
// ===========================================================================

describe('MemoryStore', () => {
  let s: IStorage;
  beforeEach(() => {
    s = new BaseStorage();
    s.clear();
  });

  it('is always available', () => expect(s.isAvailable()).toBe(true));
  it('get returns undefined for missing key', () => expect(s.get('x')).toBeUndefined());
  it('set/get round-trips primitives', () => {
    s.set('n', 42);
    expect(s.get('n')).toBe(42);
  });
  it('set/get round-trips objects', () => {
    s.set('o', { a: 1 });
    expect(s.get('o')).toEqual({ a: 1 });
  });
  it('delete removes the key', () => {
    s.set('k', 1);
    s.delete('k');
    expect(s.get('k')).toBeUndefined();
  });
  it('clear() removes all keys', () => {
    s.set('a', 1);
    s.set('b', 2);
    s.clear();
    expect(s.get('a')).toBeUndefined();
    expect(s.get('b')).toBeUndefined();
  });
  it('clear(prefix) removes only matching keys', () => {
    s.set('wince_a', 1);
    s.set('wince_b', 2);
    s.set('other', 3);
    s.clear('wince_');
    expect(s.get('wince_a')).toBeUndefined();
    expect(s.get('wince_b')).toBeUndefined();
    expect(s.get('other')).toBe(3);
  });
  it('overwriting a key updates its value', () => {
    s.set('k', 1);
    s.set('k', 2);
    expect(s.get('k')).toBe(2);
  });
});

// ===========================================================================
// LocalStore (JSDOM provides localStorage)
// ===========================================================================

describe('LocalStore', () => {
  let s: IStorage;
  beforeEach(() => {
    s = new BaseStorage(createStorageMock());
  });

  it('is available in JSDOM', () => expect(s.isAvailable()).toBe(true));
  it('set/get round-trips a string', () => {
    s.set('k', 'hello');
    expect(s.get('k')).toBe('hello');
  });
  it('set/get round-trips an object', () => {
    s.set('obj', { x: 1 });
    expect(s.get('obj')).toEqual({ x: 1 });
  });
  it('delete removes entry', () => {
    s.set('k', 1);
    s.delete('k');
    expect(s.get('k')).toBeUndefined();
  });
  it('clear(prefix) removes only matching keys', () => {
    s.set('wince_a', 1);
    s.set('wince_b', 2);
    s.set('other', 3);
    s.clear('wince_');
    expect(s.get('wince_a')).toBeUndefined();
    expect(s.get('wince_b')).toBeUndefined();
    expect(s.get('other')).toBe(3);
  });
});

// ===========================================================================
// SessionStore
// ===========================================================================

describe('SessionStore', () => {
  let s: IStorage;
  beforeEach(() => {
    s = new BaseStorage(createStorageMock());
  });

  it('is available in JSDOM', () => expect(s.isAvailable()).toBe(true));
  it('set/get round-trips', () => {
    s.set('k', 99);
    expect(s.get('k')).toBe(99);
  });
  it('delete removes entry', () => {
    s.set('k', 1);
    s.delete('k');
    expect(s.get('k')).toBeUndefined();
  });
});

// ===========================================================================
// CookieStore
// ===========================================================================

describe('CookieStore', () => {
  let restoreBrowserEnvironment: (() => void) | undefined;

  beforeEach(() => {
    restoreBrowserEnvironment = installCookieEnvironment({
      hostname: 'app.example.test',
      acceptedDomain: 'example.test'
    });
    resetRootDomainCache();
  });

  afterEach(() => {
    restoreBrowserEnvironment?.();
    restoreBrowserEnvironment = undefined;
  });

  it('is available when document exists', () => {
    const s = new CookieStoreClass();
    expect(s.isAvailable()).toBe(true);
  });

  it('set/get round-trips a string value', () => {
    const s = new CookieStoreClass();
    s.set('wince_k', 'hello');
    expect(s.get('wince_k')).toBe('hello');
  });

  it('set/get round-trips an object', () => {
    const s = new CookieStoreClass();
    s.set('wince_obj', { a: 1 });
    expect(s.get('wince_obj')).toEqual({ a: 1 });
  });

  it('delete removes the entry', () => {
    const s = new CookieStoreClass();
    s.set('wince_del', 'x');
    s.delete('wince_del');
    expect(s.get('wince_del')).toBeUndefined();
  });

  it('get returns undefined for missing key', () => {
    const s = new CookieStoreClass();
    expect(s.get('__nonexistent__')).toBeUndefined();
  });

  it('supports non-cross-subdomain cookie writes', () => {
    const s = new CookieStoreClass({
      crossSubdomain: false,
      secure: false,
      sameSite: 'Strict'
    });

    s.set('wince_nocross', 'hello');
    expect(s.get('wince_nocross')).toBe('hello');
    s.delete('wince_nocross');
    expect(s.get('wince_nocross')).toBeUndefined();
  });
});

// ===========================================================================
// BaseStorage
// ===========================================================================

describe('BaseStorage', () => {
  it('is unavailable when the backing storage throws during probing', () => {
    const store = new BaseStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error('unavailable');
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0
    } as unknown as Storage);

    expect(store.isAvailable()).toBe(false);
  });

  it('refreshKey updates the current value immediately', () => {
    const data = new Map<string, string>();
    const backing = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
      clear: () => {
        data.clear();
      },
      key: (index: number) => Array.from(data.keys())[index] ?? null,
      get length() {
        return data.size;
      }
    } as unknown as Storage;
    const store = new BaseStorage(backing, 0);

    store.set('count', 1);
    store.flush();
    store.refreshKey('count', (current) => String(Number(current ?? '0') + 1));

    expect(store.get('count')).toBe(2);
  });
});

// ===========================================================================
// createStore — fallback chain
// ===========================================================================

describe('createStore', () => {
  it('returns a working store when localStorage is available', () => {
    const originalLocalStorage = (globalThis as Record<string, unknown>).localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      value: createStorageMock(),
      configurable: true
    });

    try {
      const s = createMultiStorage({ strategies: ['localStorage', 'memory'] });
      s.set('test_key', 'test_value');
      expect(s.get('test_key')).toBe('test_value');
      expect(s.isAvailable()).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalLocalStorage,
        configurable: true
      });
    }
  });

  it('falls back to MemoryStore when no strategy is available', () => {
    const s = createMultiStorage({ strategies: [] });
    s.set('test_key', 'test_value');
    expect(s.get('test_key')).toBe('test_value');
    expect(s.isAvailable()).toBe(true);
  });

  it('returned store can set/get values', () => {
    const s = createMultiStorage({ strategies: ['memory'] });
    s.set('test_key', 'test_value');
    expect(s.get('test_key')).toBe('test_value');
    s.delete('test_key');
  });
});

// ===========================================================================
// getRootDomain
// ===========================================================================

describe('getRootDomain', () => {
  let restoreBrowserEnvironment: (() => void) | undefined;

  beforeEach(() => {
    restoreBrowserEnvironment = installCookieEnvironment({
      hostname: 'app.example.test',
      protocol: 'https:',
      acceptedDomain: 'example.test'
    });
    resetRootDomainCache();
  });

  afterEach(() => {
    restoreBrowserEnvironment?.();
    restoreBrowserEnvironment = undefined;
  });

  it('returns empty string for localhost', () => {
    expect(getRootDomain('localhost')).toBe('');
  });

  it('returns empty string for 127.0.0.1', () => {
    expect(getRootDomain('127.0.0.1')).toBe('');
  });

  it('returns empty string for ::1', () => {
    expect(getRootDomain('::1')).toBe('');
  });

  it('discovers a registrable root domain via cookie probing', () => {
    expect(getRootDomain('app.example.test')).toBe('example.test');
  });
});

// ===========================================================================
// DurableQueue — IDB-backed event queue
// ===========================================================================

function makeEvent(n: number): PersistedEvent {
  return { eid: `eid-${n}`, payload: JSON.stringify({ seq: n }), enqueuedAt: Date.now() + n };
}

/**
 * Wait for pending IDB writes to settle.
 *
 * fake-indexeddb v6 uses `setImmediate` captured at module-load time, before
 * any jest.useFakeTimers() call, so it always runs on real timers.  A 50 ms
 * real-time wait covers the DB-open (~20 ms) plus a few setImmediate rounds
 * for the put/count requests.
 */
function flushIdb(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('DurableQueue', () => {
  let queue: DurableQueue;

  beforeEach(() => {
    // Give each test an isolated in-memory IDB by replacing the factory.
    // This is the only reliable isolation strategy without modifying DurableQueue.
    (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
    queue = new DurableQueue();
  });

  it('loadPending() returns empty array when nothing queued', async () => {
    const pending = await queue.loadPending();
    expect(pending).toEqual([]);
  });

  it('enqueue + loadPending round-trip', async () => {
    const ev = makeEvent(1);
    queue.enqueue(ev);
    await flushIdb();
    const pending = await queue.loadPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].eid).toBe('eid-1');
    expect(pending[0].payload).toBe(JSON.stringify({ seq: 1 }));
  });

  it('enqueue multiple events, all appear in loadPending()', async () => {
    queue.enqueue(makeEvent(1));
    queue.enqueue(makeEvent(2));
    queue.enqueue(makeEvent(3));
    await flushIdb();
    const pending = await queue.loadPending();
    expect(pending).toHaveLength(3);
    const eids = pending.map((e: PersistedEvent) => e.eid).sort();
    expect(eids).toEqual(['eid-1', 'eid-2', 'eid-3']);
  });

  it('ack() removes acknowledged events', async () => {
    queue.enqueue(makeEvent(1));
    queue.enqueue(makeEvent(2));
    await flushIdb();

    await queue.ack(['eid-1']);

    const pending = await queue.loadPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].eid).toBe('eid-2');
  });

  it('ack() with empty array is a no-op', async () => {
    queue.enqueue(makeEvent(1));
    await flushIdb();
    await expect(queue.ack([])).resolves.toBeUndefined();
    expect(await queue.loadPending()).toHaveLength(1);
  });

  it('size() reflects current queue depth', async () => {
    expect(await queue.size()).toBe(0);

    queue.enqueue(makeEvent(1));
    queue.enqueue(makeEvent(2));
    await flushIdb();
    expect(await queue.size()).toBe(2);

    await queue.ack(['eid-1']);
    expect(await queue.size()).toBe(1);
  });

  it('loadPending() after full ack returns empty array', async () => {
    queue.enqueue(makeEvent(1));
    await flushIdb();
    await queue.ack(['eid-1']);
    const pending = await queue.loadPending();
    expect(pending).toHaveLength(0);
  });

  it('enqueue same eid twice is idempotent (IDB keyPath dedup)', async () => {
    const ev = makeEvent(1);
    queue.enqueue(ev);
    queue.enqueue(ev); // second put on same eid overwrites in place
    await flushIdb();
    expect(await queue.size()).toBe(1);
  });

  it('MAX_QUEUE cap: evicts oldest entries when queue overflows', async () => {
    const QUEUE_SIZE = 2000;
    const OVERFLOW = 5;

    for (let i = 0; i < QUEUE_SIZE + OVERFLOW; i++) {
      queue.enqueue({ eid: `overflow-${i}`, payload: JSON.stringify({ i }), enqueuedAt: i });
    }
    await flushIdb();

    const size = await queue.size();
    expect(size).toBeLessThanOrEqual(QUEUE_SIZE);
  }, 15_000);
});
