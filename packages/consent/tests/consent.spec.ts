import { Consent, ConsentStatus } from '../src/consent.js';
import { type IStorage } from '@wince/types';

// Patch document.cookie via Object.defineProperty
function patchCookie(value: string) {
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => value,
    set: () => undefined
  });
}
function createStorageMock(): IStorage {
  const data = new Map<string, string>();

  return {
    getStrategy: () => 'cookie',
    isAvailable: () => true,
    refreshKey: (key: string, updater: (current: string | null) => string) => {
      const current = data.get(key);
      const updated = updater(current ?? null);
      data.set(key, updated);
    },
    get<T>(key: string): T | undefined {
      const raw = data.get(key);
      if (raw === undefined) return undefined;
      return JSON.parse(raw) as T;
    },
    set(key: string, value: unknown): void {
      data.set(key, JSON.stringify(value));
    },
    delete(key: string): void {
      data.delete(key);
    },
    flush: () => {
      /* no-op */
    },

    clear: () => {
      data.clear();
    }
  };
}

describe('ConsentStatus', () => {
  it('has correct values', () => {
    expect(ConsentStatus.PENDING).toBe(-1);
    expect(ConsentStatus.DENIED).toBe(0);
    expect(ConsentStatus.GRANTED).toBe(1);
  });
});

describe('Consent', () => {
  let s: IStorage;
  beforeEach(() => {
    s = createStorageMock();
  });
  it('throw error if storage is not available', () => {
    const unavailableStorage: IStorage = {
      getStrategy: () => 'cookie',
      isAvailable: () => false,
      refreshKey: () => {
        /* no-op */
      },
      get: () => undefined,
      set: () => {
        /* no-op */
      },
      delete: () => {
        /* no-op */
      },
      clear: () => {
        /* no-op */
      },
      flush: () => {
        /* no-op */
      }
    };
    expect(() => new Consent({}, unavailableStorage)).toThrow(
      'No available storage strategy found for consent manager'
    );
  });
  it('throw error if storage is not a cookie store', () => {
    const unavailableStorage: IStorage = {
      getStrategy: () => 'memory',
      isAvailable: () => false,
      refreshKey: () => {
        /* no-op */
      },
      get: () => undefined,
      set: () => {
        /* no-op */
      },
      delete: () => {
        /* no-op */
      },
      clear: () => {
        /* no-op */
      },
      flush: () => {
        /* no-op */
      }
    };
    expect(() => new Consent({}, unavailableStorage)).toThrow(
      'Consent store must be a cookie store. Please use a cookie store.SameSite is always Lax'
    );
  });

  it('starts PENDING when no cookie is set', () => {
    const mgr = new Consent({}, s);
    expect(mgr.isPending()).toBe(true);
    expect(mgr.getStatus()).toBe(ConsentStatus.PENDING);
  });

  it('reads GRANTED from stored cookie', () => {
    s.set('__wince_consent', 1);
    const mgr = new Consent({}, s);
    expect(mgr.isGranted()).toBe(true);
  });

  it('reads DENIED from stored cookie', () => {
    s.set('__wince_consent', 0);
    const mgr = new Consent({}, s);
    expect(mgr.isDenied()).toBe(true);
  });

  it('optIn() sets status to GRANTED', () => {
    const mgr = new Consent({}, s);
    mgr.optIn();
    expect(mgr.isGranted()).toBe(true);
  });

  it('optOut() sets status to DENIED', () => {
    const mgr = new Consent({}, s);
    mgr.optOut();
    expect(mgr.isDenied()).toBe(true);
  });

  it('clear() reverts to PENDING', () => {
    const mgr = new Consent({}, s);
    mgr.optIn();
    mgr.clear();
    expect(mgr.isPending()).toBe(true);
  });

  it('onChange fires when status changes', () => {
    const mgr = new Consent({}, s);
    const cb = jest.fn();
    mgr.onChange(cb);
    mgr.optIn();
    expect(cb).toHaveBeenCalledWith(ConsentStatus.GRANTED);
  });

  it('onChange does not fire if status is unchanged', () => {
    const mgr = new Consent({}, s);
    const cb = jest.fn();
    mgr.optIn();
    mgr.onChange(cb);
    mgr.optIn(); // already GRANTED
    expect(cb).not.toHaveBeenCalled();
  });

  it('onChange unsubscribe stops callbacks', () => {
    const mgr = new Consent({}, s);
    const cb = jest.fn();
    const off = mgr.onChange(cb);
    off();
    mgr.optIn();
    expect(cb).not.toHaveBeenCalled();
  });

  it('DNT overrides stored GRANTED cookie', () => {
    patchCookie('__wince_consent=1');
    Object.defineProperty(navigator, 'doNotTrack', {
      configurable: true,
      get: () => '1'
    });
    const mgr = new Consent({}, s);
    expect(mgr.isDenied()).toBe(true);
    // restore
    Object.defineProperty(navigator, 'doNotTrack', {
      configurable: true,
      get: () => null
    });
  });

  it('listener errors do not crash the manager', () => {
    const mgr = new Consent({}, s);
    mgr.onChange(() => {
      throw new Error('listener crash');
    });
    expect(() => mgr.optIn()).not.toThrow();
    expect(mgr.isGranted()).toBe(true);
  });
});
