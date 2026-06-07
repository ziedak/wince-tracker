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
  /** `document.URL` at capture time. */
  url?: string;
  /** `document.referrer` at capture time. */
  ref?: string;
  /** Allow arbitrary extra fields for forward-compat / custom enrichment. */
  [key: string]: unknown;
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
}
