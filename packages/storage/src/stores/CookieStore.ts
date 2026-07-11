// ===========================================================================
// CookieStore — for cross-subdomain identity (anonymous ID, consent flag)
// ===========================================================================

import { deserialize, serialize } from '@wince/utils';
import { IStorage, StoreKind } from '@wince/types';
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
  if (_cachedRootDomain !== null && _cachedRootDomain !== '') return _cachedRootDomain;
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
  let len = Math.min(parts.length - 1, 8); // paranoia cap, leave at least one part

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

export interface CookieStoreOptions {
  /** Default: true — sets cookie on the registrable root domain (e.g. .mystore.com) */
  crossSubdomain: boolean;
  /** Default: true when page served over HTTPS */
  secure: boolean;
  /** Default: 'Lax' */
  sameSite: 'Lax' | 'Strict' | 'None';
  /** Default: 365 */
  maxAgeDays: number;
}

const DEFAULT_COOKIE_OPTIONS: CookieStoreOptions = {
  crossSubdomain: true,
  secure: typeof location !== 'undefined' && location.protocol === 'https:',
  sameSite: 'Lax',
  maxAgeDays: 365
};
export class CookieStore implements IStorage {
  private readonly _opts: CookieStoreOptions;

  constructor(opts: Partial<CookieStoreOptions> = {}) {
    this._opts = { ...DEFAULT_COOKIE_OPTIONS, ...opts };
  }
  getStrategy(): StoreKind | StoreKind[] {
    return 'cookie';
  }

  isAvailable(): boolean {
    return typeof document !== 'undefined' && typeof document.cookie === 'string';
  }

  get<T>(key: string): T | undefined {
    if (!this.isAvailable()) return undefined;
    const prefix = key + '=';
    for (const part of document.cookie.split(';')) {
      const s = part.trimStart();
      if (s.startsWith(prefix)) {
        try {
          return deserialize<T>(decodeURIComponent(s.slice(prefix.length))) as T;
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  }

  set(key: string, value: unknown): void {
    if (!this.isAvailable()) return;
    const { crossSubdomain, secure, sameSite, maxAgeDays } = this._opts;
    const maxAge = maxAgeDays * 24 * 60 * 60;
    const domain = crossSubdomain ? getRootDomain(location.hostname) : '';
    const domainPart = domain ? `;domain=.${domain}` : '';
    const securePart = secure ? ';Secure' : '';

    document.cookie = `${key}=${encodeURIComponent(serialize(value))};max-age=${maxAge};path=/${domainPart};SameSite=${sameSite}${securePart}`;
  }

  delete(key: string): void {
    if (!this.isAvailable()) return;
    const { crossSubdomain, secure, sameSite } = this._opts;
    const domain = crossSubdomain ? getRootDomain(location.hostname) : '';
    const domainPart = domain ? `;domain=.${domain}` : '';
    const securePart = secure ? ';Secure' : '';
    // Expire on root domain AND current host to clean up old cookies
    document.cookie = `${key}=;max-age=0;path=/${domainPart};SameSite=${sameSite}${securePart}`;
    document.cookie = `${key}=;max-age=0;path=/;SameSite=${sameSite}${securePart}`;
  }

  clear(prefix?: string): void {
    if (!this.isAvailable()) return;
    for (const part of document.cookie.split(';')) {
      const name = part.trimStart().split('=')[0];
      if (!prefix || name.startsWith(prefix)) this.delete(name);
    }
  }
  flush(): void {
    /* no-op, cookies are written immediately */
  }
  refreshKey(key: string, updater: (current: string | undefined | null) => string): void {
    const current = this.get<string>(key) ?? null;
    const updated = updater(current);
    this.set(key, updated);
  }
}
