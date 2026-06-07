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
// Internal helpers
// ---------------------------------------------------------------------------

const CONSENT_COOKIE = '__wince_consent';
const MAX_AGE_DAYS   = 365;

function isDntEnabled(): boolean {
  if (typeof navigator === 'undefined') return false;
  const raw =
    (navigator as any).doNotTrack ??
    (navigator as any).msDoNotTrack ??
    (typeof window !== 'undefined' ? (window as any).doNotTrack : undefined);
  return raw === '1' || raw === 'yes' || raw === 1;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = name + '=';
  for (const part of document.cookie.split(';')) {
    const s = part.trimStart();
    if (s.startsWith(prefix)) {
      return decodeURIComponent(s.slice(prefix.length));
    }
  }
  return null;
}

function writeCookie(name: string, value: string, maxAgeDays: number): void {
  if (typeof document === 'undefined') return;
  const maxAge = maxAgeDays * 24 * 60 * 60;
  // No HttpOnly — must be browser-readable. SameSite=Lax prevents CSRF misuse.
  document.cookie =
    `${name}=${encodeURIComponent(value)};max-age=${maxAge};path=/;SameSite=Lax`;
}

function deleteCookie(name: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=;max-age=0;path=/;SameSite=Lax`;
}

function readStoredStatus(): ConsentStatus {
  const raw = readCookie(CONSENT_COOKIE);
  if (raw === '1') return ConsentStatus.GRANTED;
  if (raw === '0') return ConsentStatus.DENIED;
  return ConsentStatus.PENDING;
}

// ---------------------------------------------------------------------------
// ConsentManager
// ---------------------------------------------------------------------------

export class ConsentManager implements ConsentProvider {
  private _status: ConsentStatus;
  private _listeners: Array<(status: ConsentStatus) => void> = [];

  constructor() {
    // DNT takes precedence over any stored value.
    this._status = isDntEnabled() ? ConsentStatus.DENIED : readStoredStatus();
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
    writeCookie(CONSENT_COOKIE, '1', MAX_AGE_DAYS);
    this._notify(ConsentStatus.GRANTED);
  }

  optOut(): void {
    writeCookie(CONSENT_COOKIE, '0', MAX_AGE_DAYS);
    this._notify(ConsentStatus.DENIED);
  }

  /** Remove stored consent — reverts to PENDING on next load. */
  clear(): void {
    deleteCookie(CONSENT_COOKIE);
    this._notify(ConsentStatus.PENDING);
  }

  onChange(callback: (status: ConsentStatus) => void): () => void {
    this._listeners.push(callback);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== callback);
    };
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
