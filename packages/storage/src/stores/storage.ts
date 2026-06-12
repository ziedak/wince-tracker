// ===========================================================================
// IStore — common interface for all storage strategies
// ===========================================================================

import { CookieStoreOptions, CookieStore } from './CookieStore';
import { LocalStore } from './LocalStore';
import { MemoryStore } from './MemoryStore';
import { SessionStore } from './SessionStore';

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

export function serialize(value: unknown): string {
  return JSON.stringify(value);
}

export function deserialize(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// ===========================================================================
// LocalStore — wraps localStorage
// ===========================================================================

// Module-level cache so root-domain discovery runs once per page load.
let _cachedRootDomain: string | null = null;

/**
 * Auto-discover the registrable root domain by iteratively trying to set a
 * cookie on progressively shorter subdomains. Browsers reject public suffixes
 * (.com, .co.uk), so the first subdomain they accept is the root.
 *
 * Adapted from 's seekFirstNonPublicSubDomain.
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
  const probe = '__wince_dm__';

  let found = '';
  let len = Math.min(parts.length, 8); // paranoia cap

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
      case 'localStorage':
        store = new LocalStore();
        break;
      case 'sessionStorage':
        store = new SessionStore();
        break;
      case 'cookie':
        store = new CookieStore(opts.cookieOptions);
        break;
      case 'memory':
        return new MemoryStore(); // always available — end of fallback
    }

    if (store.isAvailable) return store;
  }

  return new MemoryStore();
}

