import { IStorage } from '@wince/types';
import { isValidUuidv4, uuidv4 } from '@wince/utils';
import type { PersonProps } from './types';

// ============================================================================
// IdentityManager
// ============================================================================

const ANON_KEY = 'wince_anon';
const UID_KEY = 'wince_uid';
const PREV_ANON_KEY = 'wince_prev_anon';

export interface IdentityManagerOptions {
  /**
   * Optional persistent store. When omitted the anonymous ID is regenerated
   * on every instantiation. Pass a `LocalStore` or `CookieStore` from
   * `@wince/storage` to make it persistent across page loads.
   */
  store?: IStorage;
}

/**
 * Manages the anonymous device ID and the optional identified user ID.
 *
 * - **Anonymous ID**: UUID v4, generated once and persisted. Stable across
 *   sessions until `reset()` is called.
 * - **User ID**: Set by calling `identify(uid)`. Cleared on `reset()`.
 */
export class IdentityManager {
  private _store?: IStorage;
  private _anonId: string;
  private _userId: string | undefined;
  /** Previous anonymous ID — set on reset(), cleared after the first event. */
  private _prevAnonId: string | undefined;

  constructor(opts: IdentityManagerOptions = {}) {
    this._store = opts.store;

    // Load or generate the anonymous ID.
    const stored = this._store?.get<string>(ANON_KEY);
    if (stored && isValidUuidv4(stored)) {
      this._anonId = stored;
    } else {
      this._anonId = uuidv4();
      this._store?.set(ANON_KEY, this._anonId);
    }

    // Load identified user ID if previously set.
    const uid = this._store?.get<string>(UID_KEY);
    if (uid) this._userId = uid;

    // Load the prev-anon ID if a reset happened on a previous page and hasn't
    // been consumed yet (one-shot: delete from store immediately after loading).
    const prevAnon = this._store?.get<string>(PREV_ANON_KEY);
    if (prevAnon && isValidUuidv4(prevAnon)) {
      this._prevAnonId = prevAnon;
      this._store?.delete?.(PREV_ANON_KEY);
    }
  }

  /** The persistent anonymous device/browser ID. */
  getAnonId(): string {
    return this._anonId;
  }

  /** The identified user ID, or `undefined` if the user has not been identified. */
  getUserId(): string | undefined {
    return this._userId;
  }

  /**
   * Associate a known user identity with this device.
   * Persists to the store so subsequent page loads keep the association.
   * Optional `traits` are passed through to the backend — not stored client-side.
   */
  identify(uid: string, traits?: PersonProps): void {
    this._userId = uid;
    this._store?.set(UID_KEY, uid);
    void traits; // traits are not stored; callers decide what to do with them
  }

  /**
   * Generate a new anonymous ID and clear the identified user ID.
   * Use on explicit log-out to break the link between device and user.
   * Saves the current anon ID as `PREV_ANON_KEY` so the next page load
   * can include `anon_prev` on the first event for identity stitching.
   */
  reset(): void {
    this._store?.set(PREV_ANON_KEY, this._anonId); // persist for next page load
    this._prevAnonId = this._anonId; // available in-session too
    this._anonId = uuidv4();
    this._userId = undefined;
    this._store?.set(ANON_KEY, this._anonId);
    this._store?.delete?.(UID_KEY);
  }

  /**
   * Returns the previous anonymous ID (set by the last `reset()` call) and
   * clears it so it only appears on the very first event after the reset.
   * Returns `undefined` if no reset has occurred.
   */
  getAndClearAnonPrev(): string | undefined {
    const prev = this._prevAnonId;
    this._prevAnonId = undefined;
    return prev;
  }

  /**
   * Attach a persistent store and immediately write current in-memory state.
   * Called when cookieless `on_reject` mode transitions to consent GRANTED.
   */
  migrateToStore(store: IStorage): void {
    this._store = store;
    store.set(ANON_KEY, this._anonId);
    if (this._userId) store.set(UID_KEY, this._userId);
  }
}
