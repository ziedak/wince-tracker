import type { CookieStoreOptions } from '@wince/storage/cookie';
import { CookieStore } from '@wince/storage/cookie';

// ---------------------------------------------------------------------------
// ConsentStatus
// ---------------------------------------------------------------------------

export const ConsentStatus = {
  PENDING: -1,
  DENIED:   0,
  GRANTED:  1,
} as const;
export type ConsentStatus = (typeof ConsentStatus)[keyof typeof ConsentStatus];

// ---------------------------------------------------------------------------
// ConsentProvider interface
// ---------------------------------------------------------------------------

export interface ConsentProvider {
  getStatus(): ConsentStatus;
  isGranted(): boolean;
  isDenied(): boolean;
  isPending(): boolean;
  /** Subscribe to status changes. Returns an unsubscribe function. */
  onChange(callback: (status: ConsentStatus) => void): () => void;
}

// ---------------------------------------------------------------------------
// ConsentManagerOptions
// ---------------------------------------------------------------------------

export type ConsentManagerOptions = {
  /**
   * Cookie name used to persist the consent decision.
   * @default '__wince_consent'
   */
  cookieName?: string;
  /**
   * When true, DNT browser signal is ignored and the stored cookie value wins.
   * Useful in test / playground environments where DNT is set by the browser
   * but should not block consent.
   * @default false
   */
  ignoreDnt?: boolean;
} & Omit<CookieStoreOptions, 'sameSite'>; // SameSite is always Lax for consent

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_COOKIE = '__wince_consent';

function isDntEnabled(): boolean {
  if (typeof navigator === 'undefined') return false;
  type DntNavigator = Navigator & { msDoNotTrack?: string };
  type DntWindow    = Window   & { doNotTrack?: string };
  const nav = navigator as DntNavigator;
  const raw =
    nav.doNotTrack ??
    nav.msDoNotTrack ??
    (typeof window !== 'undefined' ? (window as DntWindow).doNotTrack : undefined);
  return raw === '1' || raw === 'yes';
}

// ---------------------------------------------------------------------------
// ConsentManager
// ---------------------------------------------------------------------------

export class ConsentManager implements ConsentProvider {
  private readonly _store: CookieStore;
  private readonly _cookieName: string;
  private readonly _ignoreDnt: boolean;
  private _status: ConsentStatus;
  private _listeners: Array<(status: ConsentStatus) => void> = [];

  constructor(opts: ConsentManagerOptions = {}) {
    const { cookieName, ignoreDnt, ...cookieOpts } = opts;
    this._cookieName = cookieName ?? DEFAULT_COOKIE;
    this._ignoreDnt  = ignoreDnt ?? false;
    // No HttpOnly — must be browser-readable. SameSite=Lax prevents CSRF misuse.
    this._store = new CookieStore({ sameSite: 'Lax', ...cookieOpts });
    // DNT takes precedence over any stored value (unless ignoreDnt is set).
    this._status = (!this._ignoreDnt && isDntEnabled()) ? ConsentStatus.DENIED : this._readStoredStatus();
  }

  /** Returns true when the browser DNT signal is active and ignoreDnt is false. */
  isDntActive(): boolean {
    return !this._ignoreDnt && isDntEnabled();
  }

  getStatus(): ConsentStatus {
    return this._status;
  }

  isGranted(): boolean {
    return this._status === ConsentStatus.GRANTED;
  }

  isDenied(): boolean {
    return this._status === ConsentStatus.DENIED;
  }

  isPending(): boolean {
    return this._status === ConsentStatus.PENDING;
  }

  optIn(): void {
    this._store.set(this._cookieName, 1);
    this._notify(ConsentStatus.GRANTED);
  }

  optOut(): void {
    this._store.set(this._cookieName, 0);
    this._notify(ConsentStatus.DENIED);
  }

  /** Remove stored consent — reverts to PENDING on next load. */
  clear(): void {
    this._store.delete(this._cookieName);
    this._notify(ConsentStatus.PENDING);
  }

  onChange(callback: (status: ConsentStatus) => void): () => void {
    this._listeners.push(callback);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== callback);
    };
  }

  private _readStoredStatus(): ConsentStatus {
    const raw = this._store.get<number>(this._cookieName);
    // Support both numeric (new: 1/0) and legacy string ('1'/'0') cookie values.
    if (raw === 1 || (raw as unknown) === '1') return ConsentStatus.GRANTED;
    if (raw === 0 || (raw as unknown) === '0') return ConsentStatus.DENIED;
    return ConsentStatus.PENDING;
  }

  private _notify(next: ConsentStatus): void {
    if (this._status === next) return;
    this._status = next;
    for (const cb of this._listeners) {
      try { cb(next); } catch { /* never let a listener crash the manager */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export for convenience
// ---------------------------------------------------------------------------

export const consent = new ConsentManager();
export default consent;

