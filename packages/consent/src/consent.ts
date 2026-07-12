import type { IStorage } from '@wince/types';
// ---------------------------------------------------------------------------
// ConsentStatus
// ---------------------------------------------------------------------------

export enum ConsentStatus {
  PENDING = -1,
  DENIED = 0,
  GRANTED = 1
}

// ---------------------------------------------------------------------------
// Consent interface
// ---------------------------------------------------------------------------

export interface IConsent {
  getStatus(): ConsentStatus;
  isGranted(): boolean;
  isDenied(): boolean;
  isPending(): boolean;
  /** Subscribe to status changes. Returns an unsubscribe function. */
  onChange(callback: (status: ConsentStatus) => void): () => void;
  /** Opt-in to tracking. */
  optIn(): void;
  /** Opt-out of tracking. */
  optOut(): void;
  /** Remove stored consent — reverts to PENDING on next load. */
  clear(): void;
  /** Returns true when the browser DNT signal is active and ignoreDnt is false. */
  isDntActive(): boolean;
}

// ---------------------------------------------------------------------------
// ConsentOptions
// ---------------------------------------------------------------------------

export type ConsentOptions = {
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
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_COOKIE = '__wince_consent';

function isDntEnabled(): boolean {
  if (typeof navigator === 'undefined') return false;
  type DntNavigator = Navigator & { msDoNotTrack?: string };
  type DntWindow = Window & { doNotTrack?: string };
  const nav = navigator as DntNavigator;
  const raw =
    nav.doNotTrack ??
    nav.msDoNotTrack ??
    (typeof window !== 'undefined' ? (window as DntWindow).doNotTrack : undefined);
  return raw === '1' || raw === 'yes';
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export class Consent implements IConsent {
  // Important: the store must be a cookie store, because we need to persist consent across subdomains and page reloads. LocalStorage and SessionStorage are not shared across subdomains, and memory storage is not persisted at all.

  private readonly _cookieName: string;
  private readonly _ignoreDnt: boolean;
  private _status: ConsentStatus;
  private _listeners: Array<(status: ConsentStatus) => void> = [];

  constructor(
    opts: ConsentOptions = {},
    private readonly _store: IStorage
  ) {
    this._cookieName = opts.cookieName ?? DEFAULT_COOKIE;
    this._ignoreDnt = opts.ignoreDnt ?? false;
    // No HttpOnly — must be browser-readable. SameSite=Lax prevents CSRF misuse.
    // SameSite is always Lax for consent, because we want the cookie to be sent on top-level navigations and GET requests, but not on cross-site POST requests. This is a security measure to prevent CSRF attacks. The cookie is also set with the Secure flag if the page is served over HTTPS, which ensures that the cookie is only sent over secure connections.
    if (this._store.getStrategy() !== 'cookie') {
      throw new Error(
        'Consent store must be a cookie store. Please use a cookie store.SameSite is always Lax'
      );
    }
    if (!this._store.isAvailable()) {
      throw new Error('No available storage strategy found for consent manager');
    }
    // this._store = new CookieStore({ sameSite: 'Lax', ...cookieOpts });
    // DNT takes precedence over any stored value (unless ignoreDnt is set).
    this._status =
      !this._ignoreDnt && isDntEnabled() ? ConsentStatus.DENIED : this._readStoredStatus();
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
    if (raw === 1) return ConsentStatus.GRANTED;
    if (raw === 0) return ConsentStatus.DENIED;
    return ConsentStatus.PENDING;
  }

  private _notify(next: ConsentStatus): void {
    if (this._status === next) return;
    this._status = next;
    for (const cb of this._listeners) {
      try {
        cb(next);
      } catch {
        /* never let a listener crash the consent manager */
      }
    }
  }
}
