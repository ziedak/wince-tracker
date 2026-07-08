import type {  PersonProps } from '@wince/core';
import { TrackEventPayload } from '@wince/types';

// ---------------------------------------------------------------------------
// WorkerConfig — serialisable subset of WinceConfig (no functions)
// ---------------------------------------------------------------------------

export interface WorkerConfig {
  /** Session idle timeout in ms. Default: 30 minutes. */
  sessionIdleTimeoutMs?: number;
  /** Hard cap on session duration (ms). Default: 24 hours. */
  sessionMaxDurationMs?: number;
  /** Fraction of events to keep (0–1). Default: 1. */
  sampleRate?: number;
  /** Cookieless persistence mode — mirrors WinceConfig.cookieless. */
  cookieless?: 'off' | 'on_reject' | 'always';
  /** Whether consent is already granted at init time (used by on_reject mode). */
  initialConsentGranted?: boolean;
}

// ---------------------------------------------------------------------------
// Main thread → Worker
// ---------------------------------------------------------------------------

export type MainToWorkerMsg =
  /** Sent once, before any other message. */
  | { type: 'init';         config: WorkerConfig }
  /** Capture an event. DOM fields (url, ref) and tab fields (window_id, pageview_id) must be read on the main thread. */
  | ({ type: 'track'; name: string; props?: Record<string, unknown>; url?: string; ref?: string; window_id?: string; pageview_id?: string; prev_pageview_id?: string } & PersonProps)
  /** Associate device with a known user identity. */
  | ({ type: 'identify'; uid: string } & PersonProps)
  /** Reset session + identity (e.g. on logout). */
  | { type: 'reset' }
  /** Request replay of un-acked events from IndexedDB. */
  | { type: 'load_pending' }
  /**
   * Synchronisation barrier: Worker replies with `flush_ack` once all
   * messages posted before this one have been processed (including any
   * `enriched` replies). The main thread uses this to ensure the Transport
   * queue is fully loaded before calling `transport.flush()`.
   */
  | { type: 'flush'; seq: number }
  /** Acknowledge successful delivery — remove from DurableQueue. */
  | { type: 'ack'; eids: string[] }
  /** Notify Worker that consent status changed (used in cookieless on_reject mode). */
  | { type: 'consent_change'; granted: boolean }
  /** Request the current IDB queue size (for diagnostics). */
  | { type: 'idb_size_request'; seq: number };

// ---------------------------------------------------------------------------
// Worker → main thread
// ---------------------------------------------------------------------------

export type WorkerToMainMsg =
  /** Enriched event ready to be handed to the HTTP Transport. */
  | { type: 'enriched';   event: TrackEventPayload }
  /** Un-acked events loaded from IndexedDB on startup (replay). */
  | { type: 'pending';    events: TrackEventPayload[] }
  /** Reply to a `flush` message. All enriched events up to this point have been posted. */
  | { type: 'flush_ack';  seq: number }
  /** Reply to an `idb_size_request` message. */
  | { type: 'idb_size_response'; seq: number; size: number }
  /**
   * Posted once, immediately after the Worker finishes `handleInit()`.
   * Carries the anon ID and session ID so the main thread can include them
   * in the first-party enrichment request (`?anon=...&session=...`).
   */
  | { type: 'identity_snapshot'; anon: string; session: string }
  /** Non-fatal Worker error — informational only. */
  | { type: 'error';      message: string };
