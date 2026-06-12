import type { DropReason } from '@wince/transport';
import { createClientTransport } from '@wince/transport';
import {
  Pipeline,
  SessionManager,
  IdentityManager,
  SequenceCounter,
  SamplingFilter,
  uuidv7,
  type TrackEvent,
  type PersonProps,
  type MinimalStore,
} from '@wince/core';
import { createStore, type IStore, type StoreKind } from '@wince/storage';
import type { ConsentProvider } from '@wince/consent';
import { wireConsent } from './lib/consentWire';
import { buildBaseDiagnostics } from './lib/diagnostics';
import { fetchEnrichment } from './lib/enrichment';
import { applyEnrichmentOnceToEvents } from './lib/preEnrich';
import { BaseClient } from './lib/baseClient';
import { mountPageView, PageViewOptions } from './plugins/pageView';
import { mountClick } from './plugins/click';

// ---------------------------------------------------------------------------
// Adapter: IStore (unknown-typed get) → MinimalStore (string | null get)
// ---------------------------------------------------------------------------

function toMinimalStore(store: IStore): MinimalStore {
  const base: MinimalStore = {
    get: (k) => {
      const v = store.get(k);
      return typeof v === 'string' ? v : null;
    },
    set: (k, v) => store.set(k, v),
    delete: (k) => store.delete(k),
  };
  // Wire refreshKey if the underlying store supports it (LocalStore).
  if (typeof (store as { refreshKey?: unknown }).refreshKey === 'function') {
    type WithRefresh = {
      refreshKey(k: string, u: (c: string | null) => string): void;
    };
    base.refreshKey = (k, updater) =>
      (store as unknown as WithRefresh).refreshKey(k, updater);
  }
  return base;
}

// ---------------------------------------------------------------------------
// WinceDiagnostics — runtime observability snapshot
// ---------------------------------------------------------------------------

export interface WinceDiagnostics {
  /** Events currently waiting in the in-memory Transport buffer. */
  eventsQueued: number;
  /** Events successfully delivered to the ingest endpoint this session. */
  eventsSent: number;
  /** Total events dropped (sum of all droppedByReason values). */
  eventsDropped: number;
  /** Per-reason drop counters (only reasons that have occurred are present). */
  droppedByReason: Partial<Record<DropReason, number>>;
  /** Whether the circuit breaker is currently open (blocking HTTP sends). */
  circuitOpen: boolean;
  /** Promise resolving to the number of events pending in IndexedDB (Worker path only; 0 otherwise). */
  idbQueueSize: Promise<number>;
  /** Current session ID. Undefined in Worker path (session lives off main thread). */
  sessionId?: string;
  /** Tab-scoped window ID. */
  windowId: string;
  /** Anonymous device/browser ID. Undefined in Worker path. */
  anonId?: string;
}

// ---------------------------------------------------------------------------
// WinceConfig
// ---------------------------------------------------------------------------

export interface WinceConfig {
  /** Ingest API endpoint URL. */
  endpoint: string;

  /** Events per HTTP batch. Default: 20 */
  batchSize?: number;
  /** Max hold time for a partial batch (ms). Default: 2 000 */
  batchTimeoutMs?: number;
  /** Gzip-compress request bodies. Default: true */
  compress?: boolean;
  /** Max events held in the in-memory buffer. Default: 500 */
  maxBufferSize?: number;

  /** Session idle timeout (ms). Default: 30 minutes */
  sessionIdleTimeoutMs?: number;
  /** Hard cap on session duration (ms). Default: 24 hours */
  sessionMaxDurationMs?: number;

  /** Fraction of events to keep (0–1). Default: 1 (keep all). */
  sampleRate?: number;

  /**
   * Ordered list of storage backends to try.
   * The first available backend wins.
   * Default: `['localStorage', 'sessionStorage', 'cookie', 'memory']`
   */
  storagePreference?: StoreKind[];

  /**
   * Consent provider. Defaults to the singleton from `@wince/consent`.
   * Pass `null` to disable consent gating entirely (e.g. for GDPR-exempt use-cases).
   */
  consent?: ConsentProvider | null;

  /**
   * Custom enrichment / filter hook — runs after core enrichment.
   * Return the (possibly modified) event to keep it, or `null`/`undefined` to drop it.
   */
  beforeTrack?: (event: TrackEvent) => TrackEvent | null | undefined;

  /** Extra headers sent with every batch request. */
  headers?: Record<string, string>;

  retry?: {
    attempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };

  /** Injectable fetch for testing. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;

  /**
   * Called whenever an event is permanently lost or blocked from delivery.
   * `event` is the raw event payload if available (absent for pre-enqueue drops
   * such as consent or sampling rejections).
   */
  onEventDropped?: (reason: DropReason, event?: Partial<TrackEvent>) => void;

  /**
   * Cookieless consent mode. Default: `'off'` (standard persistent identity).
   * - `'on_reject'` — use session-only identity until consent is GRANTED; then
   *   persist the in-memory anon ID / session to the store (one-time migration).
   * - `'always'` — never write to localStorage / cookies; session-scoped
   *   identity only (e.g. for GDPR-exempt deploys that prefer no storage at all).
   */
  cookieless?: 'off' | 'on_reject' | 'always';

  /**
   * URL of a first-party enrichment endpoint.
   * On init the SDK fires `GET <enrichmentUrl>?anon=<id>&session=<id>`.
   * The response may include `{ uid?, $set?, $set_once?, ...props }` to
   * pre-identify the visitor and attach UTM / cart context on the first event.
   * The transport stays paused until enrichment resolves or times out.
   */
  enrichmentUrl?: string;

  /**
   * Max ms to wait for the enrichment response before starting the transport
   * without enrichment context. Default: 1 500.
   */
  enrichmentTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// WinceClient
// ---------------------------------------------------------------------------

export class WinceClient extends BaseClient {
  private readonly _pipeline: Pipeline<TrackEvent>;
  private readonly _session: SessionManager;
  private readonly _identity: IdentityManager;
  private readonly _seq: SequenceCounter;
  private readonly _sampler?: SamplingFilter;
  private readonly _store: IStore;
  private readonly _minStore: MinimalStore;
  private _preEnrichQueue: TrackEvent[] = [];
  private _lastErrorEid?: string;
  private _lastErrorTimer?: ReturnType<typeof setTimeout>;
  private _beforeDrainHooks: Array<() => void> = [];

  constructor(config: WinceConfig) {
    super({
      consent: config.consent,
      fetch: config.fetch,
      onEventDropped: config.onEventDropped,
      enrichmentReady: !config.enrichmentUrl,
    });

    const store = createStore({
      strategies: config.storagePreference ?? [
        'localStorage',
        'sessionStorage',
        'cookie',
        'memory',
      ],
    });
    const minStore = toMinimalStore(store);
    this._store = store;
    this._minStore = minStore;

    // Resolve consent provider first — needed to compute initial store policy.
    const initialGranted = this._consent === null || this._consent.isGranted();
    const usePersistentStore =
      config.cookieless !== 'always' &&
      (config.cookieless !== 'on_reject' || initialGranted);

    this._session = new SessionManager({
      idleTimeoutMs: config.sessionIdleTimeoutMs,
      maxDurationMs: config.sessionMaxDurationMs,
      store: usePersistentStore ? minStore : undefined,
    });
    this._identity = new IdentityManager({
      store: usePersistentStore ? minStore : undefined,
    });
    this._seq = new SequenceCounter();

    if (config.sampleRate !== undefined && config.sampleRate < 1) {
      this._sampler = new SamplingFilter({ rate: config.sampleRate });
    }

    // Transport always starts paused; _maybeStart() unpauses when both
    // consent is OK and enrichment (if configured) has resolved.
    this._enrichmentReady = !config.enrichmentUrl;

    this._transport = createClientTransport({
      url: config.endpoint,
      compress: config.compress,
      batchSize: config.batchSize,
      batchTimeoutMs: config.batchTimeoutMs,
      maxBufferSize: config.maxBufferSize,
      headers: config.headers,
      retry: config.retry,
      fetch: config.fetch,
      paused: true,
      onDropped: (reason, item) => {
        this._diag.droppedByReason[reason] =
          (this._diag.droppedByReason[reason] ?? 0) + 1;
        this._onEventDropped?.(reason, item);
      },
      onBatchDelivered: (eids) => {
        this._diag.sent += eids.length;
      },
      eventPriority: (event) => {
        const t = event['t'] as string | undefined;
        if (t === '$checkout_complete') return 100;
        if (t === '$form_abandon') return 90;
        if (t?.startsWith('$cart_')) return 80;
        return 10;
      },
    });

    // React to consent status changes.
    if (this._consent !== null) {
      this._unsubConsent = wireConsent(this._consent, config.cookieless, {
        onGrant: () => this._maybeStart(),
        onRevoke: () => this._transport.pause(),
        onMigrate: () => {
          this._identity.migrateToStore(this._minStore);
          this._session.migrateToStore(this._minStore);
        },
      });
    }

    // Custom enrichment / filter hook
    this._pipeline = new Pipeline<TrackEvent>();
    if (config.beforeTrack) {
      this._pipeline.use(config.beforeTrack);
    }

    this._attachListeners();

    // Kick off enrichment or start the transport immediately.
    if (config.enrichmentUrl) {
      void this._runEnrichment(
        config.enrichmentUrl,
        config.enrichmentTimeoutMs ?? 1_500,
      );
    } else {
      this._maybeStart();
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Track an event. No-op when consent is required but not yet granted.
   * The event is enriched with session, identity, timing, and URL fields
   * before being queued for delivery.
   *
   * @param personProps - Optional person traits merged into the user record.
   *   `$set` is applied on every occurrence; `$set_once` only when the key
   *   is not yet present on the backend user record.
   */
  track(
    name: string,
    props?: Record<string, unknown>,
    personProps?: PersonProps,
  ): void {
    console.debug('[Wince] track', name, props, personProps);
    if (this._consent !== null && !this._consent.isGranted()) {
      this._drop('consent');
      return;
    }
    if (
      this._sampler &&
      !this._sampler.shouldTrack(this._identity.getAnonId())
    ) {
      this._drop('sampling');
      return;
    }
    this._enqueueRaw(name, props, this._pageviewId, undefined, personProps);
  }

  /**
   * Track an explicit page view.
   * Rotates the `pageview_id` / `prev_pageview_id` chain before emitting,
   * so funnel queries can follow navigation hops.
   */
  page(props?: Record<string, unknown>): void {
    if (this._consent !== null && !this._consent.isGranted()) {
      this._drop('consent');
      return;
    }
    if (
      this._sampler &&
      !this._sampler.shouldTrack(this._identity.getAnonId())
    ) {
      this._drop('sampling');
      return;
    }

    // Dedup check BEFORE rotating pageviewId so a dropped duplicate does not
    // advance the pageview chain (which would leave subsequent track() calls
    // referencing a pageview_id with no matching $page_view event).
    const dedupKey = `$page_view:${JSON.stringify(props ?? null)}`;
    if (this._recentEvents.has(dedupKey)) {
      this._drop('client_dedup');
      return;
    }
    this._recentEvents.set(dedupKey, true);

    this._prevPageviewId = this._pageviewId;
    this._pageviewId = uuidv7();

    this._enqueueRaw(
      '$page_view',
      {
        title: typeof document !== 'undefined' ? document.title : undefined,
        ref:
          typeof document !== 'undefined'
            ? document.referrer || undefined
            : undefined,
        ...props,
      },
      this._pageviewId,
      this._prevPageviewId,
      undefined,
      false, // dedup already checked and recorded above — skip the check in _enqueueRaw
    );
  }

  /**
   * Associate the current device with a known user identity.
   * Optional `traits` are forwarded to the backend as person properties
   * on a synthetic `$identify` event — no client-side storage.
   */
  identify(uid: string, traits?: PersonProps): void {
    this._identity.identify(uid, traits);
    if (traits?.$set || traits?.$set_once) {
      this._enqueueRaw(
        '$identify',
        undefined,
        this._pageviewId,
        undefined,
        traits,
      );
    }
  }

  /**
   * Reset identity and start a new session.
   * Generates a fresh anonymous ID — call on explicit log-out.
   */
  reset(): void {
    this._identity.reset();
    this._session.reset();
    this._seq.reset();
    this._pageviewId = undefined;
    this._prevPageviewId = undefined;
    // Clear per-user dedup state and near-error context so the new session
    // is not affected by events from the previous user.
    this._recentEvents.clear();
    this._lastErrorEid = undefined;
    if (this._lastErrorTimer !== undefined) {
      clearTimeout(this._lastErrorTimer);
      this._lastErrorTimer = undefined;
    }
  }

  /** Force-flush all buffered events. */
  async flush(): Promise<void> {
    await this._transport.flush();
  }

  /**
   * Detach all lifecycle listeners and close the transport gracefully,
   * flushing any buffered events via normal HTTP (awaited).
   *
   * For page-unload scenarios use the `pagehide` listener instead
   * (installed automatically), which calls `transport.drain()` via sendBeacon.
   */
  async close(): Promise<void> {
    this._unsubConsent?.();
    this._removeListeners?.();
    await this._transport.close();
  }

  /**
   * Register a callback to be invoked immediately before the transport drains
   * on `pagehide`. Use this to enqueue final events (e.g. `$page_leave`) so
   * they are included in the sendBeacon payload.
   *
   * @returns A function that removes the hook.
   */
  addBeforeDrainHook(fn: () => void): () => void {
    this._beforeDrainHooks.push(fn);
    return () => {
      this._beforeDrainHooks = this._beforeDrainHooks.filter((h) => h !== fn);
    };
  }

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  /**
   * Starts the transport when all pre-conditions are met:
   * consent is granted (or not required) AND enrichment has resolved.
   */

  /**
   * Fire a GET request to `enrichmentUrl`, merge the response into the first
   * event, and then start the transport via `_maybeStart()`.
   */
  private async _runEnrichment(url: string, timeoutMs: number): Promise<void> {
    try {
      const res = await fetchEnrichment(
        url,
        () => this._identity.getAnonId(),
        () => this._session.getSid(),
        this._fetch,
        timeoutMs,
      );
      if (res) {
        if (res.uid) this.identify(res.uid, res.personProps);
        else if (res.personProps) this._enrichmentPersonProps = res.personProps;
        if (res.props) this._enrichmentProps = res.props;
      }
    } catch {
      // proceed without enrichment on any error
    } finally {
      this._enrichmentReady = true;
      // Flush events buffered before enrichment resolved. Apply props to the
      // first non-$identify event (auto-generated $identify events don't need
      // UTM / cart context; props should land on the first user-visible event).
      if (this._preEnrichQueue.length > 0) {
        const queue = this._preEnrichQueue;
        this._preEnrichQueue = [];
        const { events } = applyEnrichmentOnceToEvents(
          queue,
          this._enrichmentProps,
          this._enrichmentPersonProps,
        );
        // Clear one-shot enrichment props after applying
        this._enrichmentProps = undefined;
        this._enrichmentPersonProps = undefined;
        for (const ev of events) this._dispatchEvent(ev);
      }
      this._maybeStart();
    }
  }

  /**
   * Returns a snapshot of runtime counters and state — useful for dashboards,
   * support tooling, and debugging dropped events.
   */
  diagnostics(): WinceDiagnostics {
    const base = buildBaseDiagnostics(
      this._diag,
      this._transport,
      Promise.resolve(0),
    );
    return {
      ...base,
      sessionId: this._session.peekSid(),
      windowId: this._windowId,
      anonId: this._identity.getAnonId(),
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Build, pipeline-enrich, and send one event.
   * All public tracking methods funnel through here so enrichment logic
   * lives in exactly one place — easy to extend in future phases.
   */
  private _enqueueRaw(
    name: string,
    props: Record<string, unknown> | undefined,
    pageview_id: string | undefined,
    prev_pageview_id?: string,
    personProps?: PersonProps,
    dedupKey?: string | false, // string = override key; false = skip dedup (already checked by caller)
  ): void {
    // Client-side dedup: drop repeated identical event+props within the TTL window.
    if (dedupKey !== false) {
      const key = dedupKey ?? `${name}:${JSON.stringify(props ?? null)}`;
      if (this._recentEvents.has(key)) {
        this._drop('client_dedup');
        return;
      }
      this._recentEvents.set(key, true);
    }

    this._session.touch();

    // Near-error context: tag events that fire within 30 s of an unhandled crash.
    const finalProps =
      name !== '$error' && this._lastErrorEid
        ? { $near_error: true, $error_eid: this._lastErrorEid, ...props }
        : props;

    const eid = uuidv7();
    const raw: TrackEvent = {
      eid,
      seq: this._seq.next(),
      t: name,
      ts: Date.now(),
      sid: this._session.getSid(),
      anon: this._identity.getAnonId(),
      uid: this._identity.getUserId(),
      props: finalProps,
      $set: personProps?.$set,
      $set_once: personProps?.$set_once,
      url: typeof document !== 'undefined' ? document.URL : undefined,
      ref:
        typeof document !== 'undefined'
          ? document.referrer || undefined
          : undefined,
      window_id: this._windowId,
      pageview_id,
      prev_pageview_id,
      anon_prev: this._identity.getAndClearAnonPrev(),
    };

    // Record error EID so subsequent events can be tagged with $near_error.
    if (name === '$error') {
      this._lastErrorEid = eid;
      if (this._lastErrorTimer !== undefined)
        clearTimeout(this._lastErrorTimer);
      this._lastErrorTimer = setTimeout(() => {
        this._lastErrorEid = undefined;
      }, 30_000);
    }

    if (!this._enrichmentReady) {
      // Hold pre-enrichment events so the first one can receive enrichment props
      // when the GET response arrives (not consumed here — timing is unpredictable).
      this._preEnrichQueue.push(raw);
      return;
    }

    this._dispatchEvent(this._applyEnrichmentOnce(raw));
  }

  /** Apply one-shot enrichment props to a raw event, then clear them. */
  private _applyEnrichmentOnce(raw: TrackEvent): TrackEvent {
    if (!this._enrichmentProps && !this._enrichmentPersonProps) return raw;
    const result: TrackEvent = {
      ...raw,
      props: this._enrichmentProps
        ? { ...this._enrichmentProps, ...raw.props }
        : raw.props,
      $set: this._enrichmentPersonProps
        ? { ...this._enrichmentPersonProps.$set, ...raw.$set }
        : raw.$set,
      $set_once: this._enrichmentPersonProps
        ? { ...this._enrichmentPersonProps.$set_once, ...raw.$set_once }
        : raw.$set_once,
    };
    this._enrichmentProps = undefined;
    this._enrichmentPersonProps = undefined;
    return result;
  }

  private _dispatchEvent(raw: TrackEvent): void {
    const enriched = this._pipeline.run(raw);
    if (enriched) this._transport.send(enriched);
  }

  // -------------------------------------------------------------------------
  // Browser lifecycle
  // -------------------------------------------------------------------------

  private _attachListeners(): void {
    if (typeof window === 'undefined') return;

    const onPageHide = () => {
      for (const hook of this._beforeDrainHooks) hook();
      this._store.flush?.(); // flush pending store writes before the page unloads
      this._transport.drain();
    };
    const onOffline = () => this._transport.pause();
    const onOnline = () => {
      this._maybeStart();
      void this._transport.flush(); // immediately drain buffered events on reconnect
    };

    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    // Network quality adaptation — adjust batch config based on effective connection type.
    const conn = (
      navigator as Navigator & {
        connection?: {
          effectiveType?: string;
          addEventListener?(t: string, fn: () => void): void;
          removeEventListener?(t: string, fn: () => void): void;
        };
      }
    ).connection;

    const applyConnectionConfig = () => {
      const cfg = _batchConfigForConnection(conn?.effectiveType ?? '');
      if (cfg)
        this._transport.updateBatchConfig(cfg.batchSize, cfg.batchTimeoutMs);
    };

    if (conn) {
      applyConnectionConfig();
      conn.addEventListener?.('change', applyConnectionConfig);
    }

    this._removeListeners = () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      conn?.removeEventListener?.('change', applyConnectionConfig);
    };
  }
}

// ---------------------------------------------------------------------------
// Network quality — batch config overrides
// ---------------------------------------------------------------------------

interface BatchConfig {
  batchSize: number;
  batchTimeoutMs: number;
}

function _batchConfigForConnection(effectiveType: string): BatchConfig | null {
  switch (effectiveType) {
    case '4g':
      return { batchSize: 20, batchTimeoutMs: 2_000 };
    case '3g':
      return { batchSize: 10, batchTimeoutMs: 3_000 };
    case '2g':
      return { batchSize: 5, batchTimeoutMs: 5_000 };
    case 'slow-2g':
      return { batchSize: 3, batchTimeoutMs: 8_000 };
    default:
      return null; // keep configured defaults
  }
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

/**
 * Initialise a `WinceClient` instance.
 *
 * ```ts
 * const wince = init({ endpoint: 'https://ingest.example.com/events' });
 * wince.track('page_view');
 * ```
 */
export function init(config: WinceConfig): WinceClient {
  return new WinceClient(config);
}
export function  activatePlugins(client: WinceClient): void {
    mountPageView(client);
    mountClick(client);
  }
