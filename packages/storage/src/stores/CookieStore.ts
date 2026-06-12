// ===========================================================================
// CookieStore — for cross-subdomain identity (anonymous ID, consent flag)
// ===========================================================================

import { deserialize, getRootDomain, IStore, serialize } from './storage';

export interface CookieStoreOptions {
  /** Default: true — sets cookie on the registrable root domain (e.g. .mystore.com) */
  crossSubdomain?: boolean;
  /** Default: true when page served over HTTPS */
  secure?: boolean;
  /** Default: 'Lax' */
  sameSite?: 'Lax' | 'Strict' | 'None';
  /** Default: 365 */
  maxAgeDays?: number;
}

export class CookieStore implements IStore {
  readonly isAvailable: boolean;
  private readonly _opts: Required<CookieStoreOptions>;

  constructor(opts: CookieStoreOptions = {}) {
    this._opts = {
      crossSubdomain: opts.crossSubdomain ?? true,
      secure:
        opts.secure ??
        (typeof location !== 'undefined' && location.protocol === 'https:'),
      sameSite: opts.sameSite ?? 'Lax',
      maxAgeDays: opts.maxAgeDays ?? 365,
    };
    this.isAvailable =
      typeof document !== 'undefined' && typeof document.cookie === 'string';
  }

  get(key: string): unknown {
    if (!this.isAvailable) return undefined;
    const prefix = key + '=';
    for (const part of document.cookie.split(';')) {
      const s = part.trimStart();
      if (s.startsWith(prefix)) {
        try {
          return deserialize(decodeURIComponent(s.slice(prefix.length)));
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  }

  set(key: string, value: unknown): void {
    if (!this.isAvailable) return;
    const { crossSubdomain, secure, sameSite, maxAgeDays } = this._opts;
    const maxAge = maxAgeDays * 24 * 60 * 60;
    const domain = crossSubdomain ? getRootDomain(location.hostname) : '';
    const domainPart = domain ? `;domain=.${domain}` : '';
    const securePart = secure ? ';Secure' : '';

    document.cookie = `${key}=${encodeURIComponent(serialize(value))};max-age=${maxAge};path=/${domainPart};SameSite=${sameSite}${securePart}`;
  }

  delete(key: string): void {
    if (!this.isAvailable) return;
    const { crossSubdomain, secure, sameSite } = this._opts;
    const domain = crossSubdomain ? getRootDomain(location.hostname) : '';
    const domainPart = domain ? `;domain=.${domain}` : '';
    const securePart = secure ? ';Secure' : '';
    // Expire on root domain AND current host to clean up old cookies
    document.cookie = `${key}=;max-age=0;path=/${domainPart};SameSite=${sameSite}${securePart}`;
    document.cookie = `${key}=;max-age=0;path=/;SameSite=${sameSite}${securePart}`;
  }

  clear(prefix?: string): void {
    if (!this.isAvailable) return;
    for (const part of document.cookie.split(';')) {
      const name = part.trimStart().split('=')[0];
      if (!prefix || name.startsWith(prefix)) this.delete(name);
    }
  }
}
