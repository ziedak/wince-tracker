import { uuidv7 } from './uuid';
import type { MinimalStore } from './types';

// ============================================================================
// SessionManager
// ============================================================================

const SESSION_KEY       = 'wince_session';
const DEFAULT_IDLE_MS   = 30 * 60 * 1_000; // 30 minutes

interface SessionState {
  sid:          string;
  startedAt:    number;
  lastActiveAt: number;
}

function isSessionState(v: unknown): v is SessionState {
  return (
    typeof v === 'object' && v !== null &&
    typeof (v as SessionState).sid          === 'string' &&
    typeof (v as SessionState).startedAt    === 'number' &&
    typeof (v as SessionState).lastActiveAt === 'number'
  );
}

export interface SessionManagerOptions {
  /**
   * How long (ms) without activity before a new session starts.
   * Default: 30 minutes.
   */
  idleTimeoutMs?: number;
  /**
   * Optional persistent store. When omitted, session state lives in memory
   * only and is lost on page refresh. Pass a `LocalStore` or `CookieStore`
   * from `@wince/storage` in production.
   */
  store?: MinimalStore;
}

/**
 * Manages session lifecycle.
 *
 * A new session is started when:
 * - No previous session exists (first visit or page refresh without store)
 * - The last activity was more than `idleTimeoutMs` ago
 * - `reset()` is called explicitly
 *
 * Call `touch()` on every event to extend the current session.
 */
export class SessionManager {
  private readonly _idleTimeoutMs: number;
  private readonly _store?: MinimalStore;
  private _state: SessionState | null = null;

  constructor(opts: SessionManagerOptions = {}) {
    this._idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_MS;
    this._store         = opts.store;
    this._load();
  }

  /** Returns the current session ID, starting a new session if the previous one has expired. */
  getSid(): string {
    this._ensureActive();
    return this._state!.sid;
  }

  /**
   * Record user activity — extends the current session.
   * Starts a new session if the current one has expired.
   */
  touch(): void {
    const now = Date.now();
    if (this._isExpired(now)) {
      this._startNew(now);
    } else {
      this._state!.lastActiveAt = now;
      this._save();
    }
  }

  /** Force-start a new session immediately. */
  reset(): void {
    this._startNew(Date.now());
  }

  /** Unix ms when the current session started (starts a new session if expired). */
  get startedAt(): number {
    this._ensureActive();
    return this._state!.startedAt;
  }

  // --------------------------------------------------------------------------

  private _ensureActive(): void {
    const now = Date.now();
    if (this._isExpired(now)) this._startNew(now);
  }

  private _isExpired(now: number): boolean {
    if (!this._state) return true;
    return now - this._state.lastActiveAt > this._idleTimeoutMs;
  }

  private _startNew(now: number): void {
    this._state = { sid: uuidv7(), startedAt: now, lastActiveAt: now };
    this._save();
  }

  private _load(): void {
    const raw = this._store?.get(SESSION_KEY);
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isSessionState(parsed)) this._state = parsed;
    } catch { /* corrupted data — ignore, start fresh */ }
  }

  private _save(): void {
    if (!this._state) return;
    this._store?.set(SESSION_KEY, JSON.stringify(this._state));
  }
}
