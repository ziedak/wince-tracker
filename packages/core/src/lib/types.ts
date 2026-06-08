// ============================================================================
// Core event types
// ============================================================================

/**
 * The canonical event schema that flows through the pipeline.
 * All fields except `props`, `uid`, `url`, and `ref` are required on
 * every event so the backend can rely on them unconditionally.
 */
export interface TrackEvent {
  /** UUID v7 — unique, time-sortable event identifier. */
  eid: string;
  /** Per-session monotonically increasing sequence number (starts at 0). */
  seq: number;
  /** Event name, e.g. `'page_view'`, `'$cart_add'`. */
  t: string;
  /** Unix timestamp in milliseconds at capture time. */
  ts: number;
  /** Session ID (UUID v7). */
  sid: string;
  /** Anonymous device/browser ID (UUID v4, persisted across sessions). */
  anon: string;
  /** Identified user ID — present after `identify()` is called. */
  uid?: string;
  /** Arbitrary event-specific properties. */
  props?: Record<string, unknown>;
  /**
   * Person properties merged into the user record on every occurrence.
   * Backend applies these as a deep merge: last write wins per key.
   */
  $set?: Record<string, unknown>;
  /**
   * Person properties written only if the key is not already present on the
   * backend user record. Useful for first-touch attribution (e.g. first_seen_at).
   */
  $set_once?: Record<string, unknown>;
  /** `document.URL` at capture time. */
  url?: string;
  /** `document.referrer` at capture time. */
  ref?: string;
  /** Per-tab identifier (UUID v4, sessionStorage-scoped). Separates multi-tab flows. */
  window_id?: string;
  /** Identifier for the current page view (UUID v7). Set by WinceClient.page(). */
  pageview_id?: string;
  /** Identifier of the previous page view — present only on `$page_view` events. */
  prev_pageview_id?: string;
  /**
   * Previous anonymous ID — present only on the first event after `reset()`.
   * Allows the backend to stitch the pre-reset and post-reset device histories.
   */
  anon_prev?: string;
  /** Clock-skew correction: `sent_at - ts` in ms, set by Transport at encode time. */
  offset?: number;
  /** Schema version, set by Transport at encode time. Used for IDB migration. */
  schema_v?: number;
  /** Allow arbitrary extra fields for forward-compat / custom enrichment. */
  [key: string]: unknown;
}

/**
 * Person-level traits that can accompany any event or identify call.
 * Passed through to the backend without client-side processing.
 */
export interface PersonProps {
  $set?:      Record<string, unknown>;
  $set_once?: Record<string, unknown>;
}

/**
 * Contextual fields that the SDK enriches onto every event.
 * Passed from session + identity managers into the pipeline.
 */
export interface EventContext {
  sid: string;
  anon: string;
  uid?: string;
  seq: number;
  url?: string;
  ref?: string;
}

/**
 * Minimal key/value store interface accepted by SessionManager and
 * IdentityManager. Compatible with every `IStore` implementation in
 * `packages/storage` — pass one in from the browser SDK layer.
 */
export interface MinimalStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete?(key: string): void;
  /**
   * Synchronous read–modify–write on a single key.
   * When available, `SessionManager` uses this to avoid cross-tab clobber.
   */
  refreshKey?(key: string, updater: (current: string | null) => string): void;
}
