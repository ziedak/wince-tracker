import { uuidv4, isValidUuid } from './uuid';
import type { MinimalStore } from './types';

// ============================================================================
// IdentityManager
// ============================================================================

const ANON_KEY = 'wince_anon';
const UID_KEY  = 'wince_uid';

export interface IdentityManagerOptions {
  /**
   * Optional persistent store. When omitted the anonymous ID is regenerated
   * on every instantiation. Pass a `LocalStore` or `CookieStore` from
   * `@wince/storage` to make it persistent across page loads.
   */
  store?: MinimalStore;
}

/**
 * Manages the anonymous device ID and the optional identified user ID.
 *
 * - **Anonymous ID**: UUID v4, generated once and persisted. Stable across
 *   sessions until `reset()` is called.
 * - **User ID**: Set by calling `identify(uid)`. Cleared on `reset()`.
 */
export class IdentityManager {
  private readonly _store?: MinimalStore;
  private _anonId: string;
  private _userId: string | undefined;

  constructor(opts: IdentityManagerOptions = {}) {
    this._store = opts.store;

    // Load or generate the anonymous ID.
    const stored = this._store?.get(ANON_KEY);
    if (stored && isValidUuid(stored)) {
      this._anonId = stored;
    } else {
      this._anonId = uuidv4();
      this._store?.set(ANON_KEY, this._anonId);
    }

    // Load identified user ID if previously set.
    const uid = this._store?.get(UID_KEY);
    if (uid) this._userId = uid;
  }

  /** The persistent anonymous device/browser ID. */
  getAnonId(): string { return this._anonId; }

  /** The identified user ID, or `undefined` if the user has not been identified. */
  getUserId(): string | undefined { return this._userId; }

  /**
   * Associate a known user identity with this device.
   * Persists to the store so subsequent page loads keep the association.
   */
  identify(uid: string): void {
    this._userId = uid;
    this._store?.set(UID_KEY, uid);
  }

  /**
   * Generate a new anonymous ID and clear the identified user ID.
   * Use on explicit log-out to break the link between device and user.
   */
  reset(): void {
    this._anonId  = uuidv4();
    this._userId  = undefined;
    this._store?.set(ANON_KEY, this._anonId);
    this._store?.delete?.(UID_KEY);
  }
}
