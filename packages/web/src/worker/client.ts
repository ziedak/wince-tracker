/**
 * Main-thread side of the Web Worker integration.
 *
 * `WorkerClient` exposes the same public API as `WinceClient` but offloads
 * event enrichment (eid, seq, sid, anon, ts) and IndexedDB persistence to a
 * dedicated Worker. The HTTP transport and all DOM-access remain on the main
 * thread so `navigator.sendBeacon` keeps working on page unload.
 *
 * Use `initWithWorker(config)` instead of `init(config)` to get automatic
 * Worker / fallback selection:
 * - Worker available  → `WorkerClient`  (enrichment off main thread)
 * - Worker unavailable → `WinceClient`  (everything on main thread)
 */

import { Transport }            from '@wince/transport';
import type { DropReason }     from '@wince/transport';
import { ConsentManager, consent as globalConsent, ConsentStatus, type ConsentProvider } from '@wince/consent';
import { uuidv7 } from '@wince/core';
import type { PersonProps } from '@wince/core';
import type { WinceConfig, WinceDiagnostics } from '../client';
import { WinceClient } from '../client';
import type { TrackEvent } from '@wince/core';
import { getOrCreateWindowId } from '../_windowId';
import { LRUCache } from '@wince/cache';
import type { MainToWorkerMsg, WorkerToMainMsg, WorkerConfig } from './messages';

// ---------------------------------------------------------------------------
// WorkerClient
// ---------------------------------------------------------------------------

export class WorkerClient {
  private readonly _worker:           Worker;
  private readonly _transport:        Transport;
  private readonly _consent:          ConsentProvider | null;
  private readonly _windowId:         string;
  private readonly _onEventDropped?:  (reason: DropReason, event?: Partial<TrackEvent>) => void;
  private readonly _diag = { sent: 0, droppedByReason: {} as Partial<Record<DropReason, number>> };
  private readonly _fetch?:           (url: string, init: RequestInit) => Promise<Response>;
  private _enrichmentReady:           boolean;
  private _enrichmentProps?:          Record<string, unknown>;
  private _enrichmentPersonProps?:    PersonProps;
  private _pageviewId:                string | undefined;
  private _prevPageviewId:            string | undefined;
  private _unsubConsent?:             () => void;
  private _removeListeners?:          () => void;

  // flush() round-trip tracking
  private _flushSeq = 0;
  private readonly _flushResolvers = new Map<number, () => void>();

  // Enrichment deferred until Worker sends identity_snapshot
  private _pendingEnrichmentUrl?:      string;
  private _pendingEnrichmentTimeoutMs?: number;
  private _workerAnon?:                string;
  private _workerSession?:             string;
  // Enriched events buffered while the enrichment GET is in-flight.
  private _preEnrichEventBuffer: Array<Record<string, unknown>> = [];
  // Client-side dedup: identical event+props within 2 s are dropped.
  private readonly _recentEvents = new LRUCache<string, true>({ maxSize: 50, ttlMs: 2_000 });

  // idb_size_request round-trip tracking
  private _idbSizeSeq = 0;
  private readonly _idbSizeResolvers = new Map<number, (size: number) => void>();

  constructor(config: WinceConfig, worker: Worker) {
    this._worker = worker;
    this._worker.onmessage = (e: MessageEvent<WorkerToMainMsg>) =>
      this._onMessage(e.data);
    this._worker.onerror = (e) =>
      console.error('[WorkerClient] Worker error', e);

    // Resolve consent (same logic as WinceClient)
    this._consent =
      config.consent === undefined ? globalConsent : config.consent;

    this._windowId       = getOrCreateWindowId();
    this._onEventDropped = config.onEventDropped;
    this._fetch          = config.fetch;

    // Transport always starts paused; _maybeStart() unpauses when both
    // consent is OK and enrichment (if configured) has resolved.
    this._enrichmentReady = !config.enrichmentUrl;

    // Transport — HTTP layer stays on the main thread
    this._transport = new Transport({
      url:            config.endpoint,
      compress:       config.compress       ?? true,
      batchSize:      config.batchSize      ?? 20,
      batchTimeoutMs: config.batchTimeoutMs ?? 2_000,
      maxBufferSize:  config.maxBufferSize  ?? 500,
      headers:        config.headers,
      retry:          config.retry,
      fetch:          config.fetch,
      paused: true,
      onDropped: (reason, item) => {
        this._diag.droppedByReason[reason] = (this._diag.droppedByReason[reason] ?? 0) + 1;
        this._onEventDropped?.(reason, item);
      },
      onBatchDelivered: (eids) => {
        this._diag.sent += eids.length;
        this._post({ type: 'ack', eids });
      },
    });

    // Consent changes mirror to Transport
    if (this._consent !== null) {
      this._unsubConsent = this._consent.onChange((status) => {
        if (status === ConsentStatus.GRANTED) {
          // In on_reject mode: notify Worker so it can migrate its store.
          if (config.cookieless === 'on_reject') {
            this._post({ type: 'consent_change', granted: true });
          }
          this._maybeStart();
        } else {
          this._transport.pause();
        }
      });
    }

    // Send serialisable config fields to Worker
    const workerConfig: WorkerConfig = {
      sessionIdleTimeoutMs:  config.sessionIdleTimeoutMs,
      sessionMaxDurationMs:  config.sessionMaxDurationMs,
      sampleRate:            config.sampleRate,
      cookieless:            config.cookieless,
      initialConsentGranted: this._consent === null || this._consent.isGranted(),
    };
    this._post({ type: 'init', config: workerConfig });

    // Request IDB replay from any previously undelivered events
    this._post({ type: 'load_pending' });

    this._attachListeners();

    // Kick off enrichment or start the transport immediately.
    // Enrichment needs anon/session IDs which live in the Worker; defer until
    // the Worker posts back an identity_snapshot (sent after handleInit).
    if (config.enrichmentUrl) {
      this._pendingEnrichmentUrl      = config.enrichmentUrl;
      this._pendingEnrichmentTimeoutMs = config.enrichmentTimeoutMs ?? 1_500;
      // _enrichmentReady is already false; transport stays paused until enrichment resolves.
    } else {
      this._maybeStart();
    }
  }

  // -------------------------------------------------------------------------
  // Public API  (mirrors WinceClient)
  // -------------------------------------------------------------------------

  track(name: string, props?: Record<string, unknown>, personProps?: PersonProps): void {
    if (this._consent !== null && !this._consent.isGranted()) {
      this._drop('consent');
      return;
    }

    // Client-side dedup: drop repeated identical event+props within the TTL window.
    const dedupKey = `${name}:${JSON.stringify(props ?? null)}`;
    if (this._recentEvents.has(dedupKey)) {
      this._drop('client_dedup');
      return;
    }
    this._recentEvents.set(dedupKey, true);

    // One-shot enrichment props applied to the first event after init.
    const mergedProps: Record<string, unknown> | undefined = this._enrichmentProps
      ? { ...this._enrichmentProps, ...props }
      : props;
    this._enrichmentProps = undefined;

    const mergedPersonProps: PersonProps | undefined = this._enrichmentPersonProps
      ? {
          $set:      { ...this._enrichmentPersonProps.$set,      ...personProps?.$set },
          $set_once: { ...this._enrichmentPersonProps.$set_once, ...personProps?.$set_once },
        }
      : personProps;
    this._enrichmentPersonProps = undefined;

    this._post({
      type:  'track',
      name,
      props: mergedProps,
      url:       typeof document !== 'undefined' ? document.URL                    : undefined,
      ref:       typeof document !== 'undefined' ? (document.referrer || undefined) : undefined,
      window_id:   this._windowId,
      pageview_id: this._pageviewId,
      $set:      mergedPersonProps?.$set,
      $set_once: mergedPersonProps?.$set_once,
    });
  }

  page(props?: Record<string, unknown>): void {
    if (this._consent !== null && !this._consent.isGranted()) {
      this._drop('consent');
      return;
    }

    // Client-side dedup on user-provided props (before title/ref merge).
    const dedupKey = `$page_view:${JSON.stringify(props ?? null)}`;
    if (this._recentEvents.has(dedupKey)) {
      this._drop('client_dedup');
      return;
    }
    this._recentEvents.set(dedupKey, true);

    // One-shot enrichment props applied to the first event after init.
    const mergedProps: Record<string, unknown> | undefined = this._enrichmentProps
      ? { ...this._enrichmentProps, ...props }
      : props;
    this._enrichmentProps = undefined;
    // enrichmentPersonProps: consumed by track(), but guard here too
    const mergedPersonProps = this._enrichmentPersonProps;
    this._enrichmentPersonProps = undefined;

    this._prevPageviewId = this._pageviewId;
    this._pageviewId     = uuidv7();

    this._post({
      type:  'track',
      name:  '$page_view',
      props: {
        title: typeof document !== 'undefined' ? document.title                : undefined,
        ref:   typeof document !== 'undefined' ? (document.referrer || undefined) : undefined,
        ...mergedProps,
      },
      url:              typeof document !== 'undefined' ? document.URL                    : undefined,
      ref:              typeof document !== 'undefined' ? (document.referrer || undefined) : undefined,
      window_id:        this._windowId,
      pageview_id:      this._pageviewId,
      prev_pageview_id: this._prevPageviewId,
      $set:      mergedPersonProps?.$set,
      $set_once: mergedPersonProps?.$set_once,
    });
  }

  identify(uid: string, traits?: PersonProps): void {
    this._post({ type: 'identify', uid, $set: traits?.$set, $set_once: traits?.$set_once });
  }

  reset(): void {
    this._pageviewId     = undefined;
    this._prevPageviewId = undefined;
    // Clear per-user dedup state so the new session is not affected by events
    // from the previous user.
    this._recentEvents.clear();
    this._post({ type: 'reset' });
  }

  optIn(): void {
    if (this._consent instanceof ConsentManager) {
      this._consent.optIn();
    } else {
      this._maybeStart();
    }
  }

  optOut(): void {
    if (this._consent instanceof ConsentManager) {
      this._consent.optOut();
    } else {
      this._transport.pause();
    }
  }

  /**
   * Flush all in-flight events.
   *
   * 1. Sends a synchronisation `flush` ping to the Worker and waits for
   *    `flush_ack`. By the time the ack arrives, all `enriched` messages
   *    posted before the ping have been received and queued in the Transport.
   * 2. Flushes the HTTP Transport queue.
   */
  async flush(): Promise<void> {
    await this._workerFlush();
    await this._transport.flush();
  }

  /**
   * Gracefully shut down: flush, terminate Worker, close Transport.
   */
  async close(): Promise<void> {
    this._unsubConsent?.();
    this._removeListeners?.();
    await this.flush();
    this._worker.terminate();
    await this._transport.close();
  }

  /**
   * Returns a snapshot of runtime counters and state.
   * `idbQueueSize` is a Promise that resolves to the IDB pending count.
   */
  diagnostics(): WinceDiagnostics {
    const dropped = Object.values(this._diag.droppedByReason).reduce((a, b) => a + (b ?? 0), 0);
    return {
      eventsQueued:    this._transport.queueSize,
      eventsSent:      this._diag.sent,
      eventsDropped:   dropped,
      droppedByReason: { ...this._diag.droppedByReason },
      circuitOpen:     this._transport.circuitOpen,
      idbQueueSize:    this._requestIdbSize(),
      sessionId:       undefined, // session lives in Worker — not available on main thread
      windowId:        this._windowId,
      anonId:          undefined, // anon ID lives in Worker — not available on main thread
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private _post(msg: MainToWorkerMsg): void {
    this._worker.postMessage(msg);
  }

  private _drop(reason: DropReason): void {
    this._diag.droppedByReason[reason] = (this._diag.droppedByReason[reason] ?? 0) + 1;
    this._onEventDropped?.(reason);
  }

  private _maybeStart(): void {
    if (!this._enrichmentReady) return;
    if (this._consent !== null && !this._consent.isGranted()) return;
    this._transport.start();
  }

  private async _runEnrichment(url: string, timeoutMs: number): Promise<void> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const fetchUrl = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
      // Use the anon/session IDs received from the Worker's identity_snapshot.
      fetchUrl.searchParams.set('anon',    this._workerAnon    ?? '');
      fetchUrl.searchParams.set('session', this._workerSession ?? '');

      const fetchFn = this._fetch ?? fetch;
      const resp = await fetchFn(fetchUrl.toString(), { signal: controller.signal, method: 'GET' });
      clearTimeout(timer);

      if (resp.ok) {
        const raw: unknown = await resp.json();
        if (raw && typeof raw === 'object') {
          const data = raw as Record<string, unknown>;
          const $set     = data.$set     instanceof Object && !Array.isArray(data.$set)
            ? data.$set     as Record<string, unknown> : undefined;
          const $set_once = data.$set_once instanceof Object && !Array.isArray(data.$set_once)
            ? data.$set_once as Record<string, unknown> : undefined;
          const uid = typeof data.uid === 'string' ? data.uid : undefined;

          if (uid) {
            this.identify(uid, { $set, $set_once });
          } else if ($set || $set_once) {
            this._enrichmentPersonProps = { $set, $set_once };
          }

          const { uid: _u, $set: _s, $set_once: _so, ...rest } = data;
          if (Object.keys(rest).length > 0) this._enrichmentProps = rest;
        }
      }
    } catch {
      // Timeout, network error, or JSON parse error — proceed without enrichment.
    } finally {
      this._enrichmentReady = true;
      // Flush buffered pre-enrichment events. Apply props to the first non-$identify
      // event so UTM/cart context lands on the first user-visible event.
      if (this._preEnrichEventBuffer.length > 0) {
        const buffer = this._preEnrichEventBuffer;
        this._preEnrichEventBuffer = [];
        let applied = false;
        for (const item of buffer) {
          const ev = item as unknown as TrackEvent;
          if (!applied && ev.t !== '$identify' && (this._enrichmentProps || this._enrichmentPersonProps)) {
            this._transport.send({
              ...ev,
              props: this._enrichmentProps
                ? { ...this._enrichmentProps, ...(ev.props ?? {}) } : ev.props,
              $set: this._enrichmentPersonProps
                ? { ...this._enrichmentPersonProps.$set, ...(ev.$set ?? {}) } : ev.$set,
              $set_once: this._enrichmentPersonProps
                ? { ...this._enrichmentPersonProps.$set_once, ...(ev.$set_once ?? {}) } : ev.$set_once,
            } as unknown as Record<string, unknown>);
            this._enrichmentProps       = undefined;
            this._enrichmentPersonProps = undefined;
            applied = true;
          } else {
            this._transport.send(item);
          }
        }
      }
      this._maybeStart();
    }
  }

  private _requestIdbSize(): Promise<number> {
    return new Promise<number>((resolve) => {
      const id = this._idbSizeSeq++;
      this._idbSizeResolvers.set(id, resolve);
      this._post({ type: 'idb_size_request', seq: id });
      // Resolve with 0 if the Worker doesn't respond within 2 s (e.g. terminated).
      setTimeout(() => {
        if (this._idbSizeResolvers.delete(id)) resolve(0);
      }, 2_000);
    });
  }

  private _workerFlush(): Promise<void> {
    return new Promise<void>((resolve) => {
      const id = this._flushSeq++;
      this._flushResolvers.set(id, resolve);
      this._post({ type: 'flush', seq: id });
      // Resolve after 5 s if the Worker doesn't respond (e.g. terminated).
      setTimeout(() => {
        if (this._flushResolvers.delete(id)) resolve();
      }, 5_000);
    });
  }

  private _onMessage(msg: WorkerToMainMsg): void {
    switch (msg.type) {
      case 'enriched':
        // Worker has enriched + persisted the event; hand it to the HTTP transport.
        // Buffer events that arrive before the enrichment GET resolves so props
        // can be applied to the first real event (not auto-generated $identify).
        if (!this._enrichmentReady) {
          this._preEnrichEventBuffer.push(msg.event as unknown as Record<string, unknown>);
        } else {
          this._transport.send(msg.event as unknown as Record<string, unknown>);
        }
        break;

      case 'pending':
        // IDB replay on startup — send events that survived a previous crash.
        for (const event of msg.events) {
          this._transport.send(event as unknown as Record<string, unknown>);
        }
        break;

      case 'flush_ack':
        this._flushResolvers.get(msg.seq)?.();
        this._flushResolvers.delete(msg.seq);
        break;

      case 'idb_size_response':
        this._idbSizeResolvers.get(msg.seq)?.(msg.size);
        this._idbSizeResolvers.delete(msg.seq);
        break;

      case 'identity_snapshot':
        this._workerAnon    = msg.anon;
        this._workerSession = msg.session;
        // Fire any deferred enrichment request now that we have the real IDs.
        if (this._pendingEnrichmentUrl) {
          const url     = this._pendingEnrichmentUrl;
          const timeout = this._pendingEnrichmentTimeoutMs ?? 1_500;
          this._pendingEnrichmentUrl = undefined;
          void this._runEnrichment(url, timeout);
        }
        break;

      case 'error':
        console.error('[WorkerClient] Worker reported error:', msg.message);
        break;
    }
  }

  private _attachListeners(): void {
    if (typeof window === 'undefined') return;

    const onPageHide = () => this._transport.drain();
    const onOffline  = () => this._transport.pause();
    const onOnline   = () => {
      if (this._consent === null || this._consent.isGranted()) {
        this._transport.start();
      }
    };

    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('offline',  onOffline);
    window.addEventListener('online',   onOnline);

    this._removeListeners = () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('offline',  onOffline);
      window.removeEventListener('online',   onOnline);
    };
  }
}

// ---------------------------------------------------------------------------
// Factory — Worker + automatic fallback
// ---------------------------------------------------------------------------

/**
 * Create a tracker that uses a Web Worker for event enrichment and
 * IndexedDB persistence. Falls back to `WinceClient` (main-thread only)
 * when Workers are unavailable (old browsers, some CSPs).
 *
 * The `workerUrl` should point to the built `tracker.worker.js` file.
 * When using the ESM bundle this defaults to the file next to the SDK:
 *
 * ```ts
 * const tracker = initWithWorker({ endpoint: 'https://...' });
 * tracker.track('page_view');
 * ```
 *
 * @param config     - Same config as `init()`.
 * @param workerUrl  - URL of `tracker.worker.js`. Defaults to `./tracker.worker.js`
 *                     relative to the SDK module (ESM only). Pass an explicit URL when
 *                     using a UMD/CJS build.
 */
export function initWithWorker(
  config: WinceConfig,
  workerUrl?: string,
): WorkerClient | WinceClient {
  if (typeof Worker !== 'undefined') {
    try {
      const url = workerUrl
        // Explicit URL provided (UMD / CJS callers)
        ? new URL(workerUrl, typeof location !== 'undefined' ? location.href : undefined)
        // ESM default: resolve relative to this module
        : new URL('./tracker.worker.js', import.meta.url);

      const worker = new Worker(url);
      return new WorkerClient(config, worker);
    } catch {
      // Worker creation failed (e.g., CSP restriction, file not found).
      // Fall through to the main-thread fallback.
    }
  }

  return new WinceClient(config);
}
