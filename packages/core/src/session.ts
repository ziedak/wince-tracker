import { deserialize, isNumber, isObject, isString, serialize, uuidv7 } from '@wince/utils';
import type { IStorage } from '@wince/types';

// ============================================================================
// SessionManager
// ============================================================================

const SESSION_KEY = 'wince_session';
const DEFAULT_IDLE_MS = 30 * 60 * 1_000; // 30 minutes
const DEFAULT_MAX_DUR_MS = 24 * 60 * 60 * 1_000; // 24 hours
const ACTIVITY_PERSIST_GRANULARITY_MS = 5_000; // 5 seconds

interface SessionState {
  sid: string;
  startedAt: number;
  lastActiveAt: number;
}

function isSessionState(v: unknown): boolean {
  return (
    isObject(v) &&
    'sid' in v &&
    'startedAt' in v &&
    'lastActiveAt' in v &&
    isString(v.sid) &&
    isNumber(v.startedAt) &&
    isNumber(v.lastActiveAt)
  );
}

export interface SessionManagerOptions {
  /**
   * How long (ms) without activity before a new session starts.
   * Default: 30 minutes.
   */
  idleTimeoutMs?: number;
  /**
   * Hard cap on session duration regardless of activity (ms).
   * A tab left open overnight will start a new session after this limit.
   * Default: 24 hours.
   */
  maxDurationMs?: number;
  /**
   * Optional persistent store. When omitted, session state lives in memory
   * only and is lost on page refresh. Pass a `LocalStore` or `CookieStore`
   * from `@wince/storage` in production.
   */
  store?: IStorage;
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
  private readonly _maxDurationMs: number;
  private _store?: IStorage;
  private _state: SessionState | null = null;
  private _lastSavedAt = 0;
  private _removeStorageListener?: () => void;
  private _bc?: BroadcastChannel;

  constructor(opts: SessionManagerOptions = {}) {
    this._idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_MS;
    this._maxDurationMs = opts.maxDurationMs ?? DEFAULT_MAX_DUR_MS;
    this._store = opts.store;
    this._load();
    this._attachStorageListener();
    this._attachBroadcastChannel();
  }

  /** Returns the current session ID, starting a new session if the previous one has expired. */
  getSid(): string {
    this._ensureActive();
    if (!this._state) {
      throw new Error('Session state is unexpectedly null after _ensureActive()');
    }
    return this._state.sid;
  }

  /**
   * Returns the current session ID **without** triggering a session rotation.
   * Returns an empty string when no session has been started yet.
   * Use in read-only contexts such as diagnostics where side-effects are unwanted.
   */
  peekSid(): string {
    return this._state?.sid ?? '';
  }

  /**
   * Record user activity — extends the current session.
   * Starts a new session if the current one has expired.
   * Broadcasts the activity to other tabs via BroadcastChannel so they
   * reset their own idle countdown without starting a new session.
   */
  touch(): void {
    const now = Date.now();
    if (this._isExpired(now)) {
      this._startNew(now);
    } else {
      if (!this._state) {
        throw new Error('Session state is unexpectedly null after _ensureActive()');
      }
      this._state.lastActiveAt = now;
      if (now - this._lastSavedAt >= ACTIVITY_PERSIST_GRANULARITY_MS) {
        this._save(now);
      }
    }
    // Notify other tabs — send after state is updated so sid is current.
    if (this._state) {
      this._bc?.postMessage({ type: 'activity', sid: this._state.sid });
    }
  }

  /** Force-start a new session immediately. */
  reset(): void {
    this._startNew(Date.now());
  }

  /**
   * Unix ms when the current session started.
   * Returns 0 if no session has been started yet. Does NOT trigger a rotation.
   */
  get startedAt(): number {
    return this._state?.startedAt ?? 0;
  }

  // --------------------------------------------------------------------------

  private _ensureActive(): void {
    const now = Date.now();
    if (this._isExpired(now)) this._startNew(now);
  }

  private _isExpired(now: number, state = this._state): boolean {
    if (!state) return true;
    return (
      now - state.lastActiveAt > this._idleTimeoutMs || now - state.startedAt > this._maxDurationMs
    );
  }

  private _startNew(now: number): void {
    this._state = { sid: uuidv7(), startedAt: now, lastActiveAt: now };
    this._save(now);
  }

  private _load(): void {
    try {
      const session = this._store?.get<SessionState>(SESSION_KEY);
      if (!session || !isSessionState(session)) return;

      if (this._isExpired(Date.now(), session)) {
        // Stale session — discard it and clean up storage immediately.
        this._store?.delete?.(SESSION_KEY);
        return;
      }
      this._state = session;
    } catch {
      /* corrupted data — ignore, start fresh */
    }
  }

  /**
   * Attach a persistent store and immediately write the current session state.
   * Called when cookieless `on_reject` mode transitions to consent GRANTED.
   */
  migrateToStore(store: IStorage): void {
    this._store = store;
    if (this._state) {
      store.set(SESSION_KEY, this._state);
      this._lastSavedAt = Date.now();
    }
    this._attachStorageListener();
  }

  /** Remove cross-tab listeners. Call when the client is closed. */
  destroy(): void {
    this._removeStorageListener?.();
    this._bc?.close();
    this._bc = undefined;
  }

  // --------------------------------------------------------------------------

  private _save(now = Date.now()): void {
    if (!this._state || !this._store) return;
    if (!this._store.refreshKey) {
      this._store.set(SESSION_KEY, this._state);
    } else {
      // Atomic read–modify–write: only update `lastActiveAt` if the stored
      // session still belongs to us (prevents cross-tab overwrites from
      // clobbering a newer session started by another tab).
      const sid = this._state.sid;
      const state = this._state;
      this._store.refreshKey(SESSION_KEY, (current) => {
        if (!current) return serialize(state);
        try {
          const parsed = deserialize<SessionState>(current);
          if (!isSessionState(parsed) || (parsed as SessionState).sid !== sid) {
            return serialize(state); // corrupted or from another tab — full write fallback
          }
          return serialize({ ...(parsed as SessionState), lastActiveAt: state.lastActiveAt });
        } catch {
          return serialize(state); // corrupted — full write fallback
        }
      });
    }
    this._lastSavedAt = now;
  }

  /**
   * Open a BroadcastChannel so activity in any tab resets the idle countdown
   * in all other tabs on the same origin — without requiring a storage write.
   * Falls back silently when BroadcastChannel is not available (e.g. workers).
   */
  private _attachBroadcastChannel(): void {
    if (typeof BroadcastChannel === 'undefined') return;
    this._bc?.close();
    const bc = new BroadcastChannel('wince_session');
    bc.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as unknown;
      if (
        typeof msg !== 'object' ||
        msg === null ||
        (msg as { type: unknown }).type !== 'activity' ||
        typeof (msg as { sid: unknown }).sid !== 'string'
      )
        return;
      // Only reset if the message is for our current session.
      if (this._state?.sid !== (msg as { sid: string }).sid) return;
      // Update lastActiveAt WITHOUT calling touch() — avoids broadcast echo loop.
      const now = Date.now();
      if (!this._isExpired(now)) {
        this._state.lastActiveAt = now;
      }
    };
    this._bc = bc;
  }

  /**
   * Listen for SESSION_KEY writes by other tabs and adopt the newer session
   * state. Keeps all open tabs on the same sid without any extra round-trips.
   */
  private _attachStorageListener(): void {
    if (typeof window === 'undefined') return;
    // Remove any existing listener before (re)attaching (e.g. after migrateToStore).
    this._removeStorageListener?.();
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SESSION_KEY || e.newValue === null) return;
      try {
        const parsed = deserialize<SessionState>(e.newValue);
        if (!isSessionState(parsed)) return;
        const now = Date.now();
        // Adopt only when the remote session is not expired AND was started after
        // ours — meaning another tab did a reset or started a fresh session.
        if (
          !this._isExpired(now, parsed as SessionState) &&
          (!this._state || (parsed as SessionState).startedAt > this._state.startedAt)
        ) {
          this._state = parsed as SessionState;
        }
      } catch {
        /* ignore malformed storage writes */
      }
    };
    window.addEventListener('storage', onStorage);
    this._removeStorageListener = () => window.removeEventListener('storage', onStorage);
  }
}
