import { Transport } from '@wince/transport';
import {
  Pipeline,
  SessionManager,
  IdentityManager,
  SequenceCounter,
  SamplingFilter,
  uuidv7,
  type TrackEvent,
  type MinimalStore,
} from '@wince/core';
import { createStore, type IStore, type StoreKind } from '@wince/storage';
import {
  consent as globalConsent,
  ConsentStatus,
  ConsentManager,
  type ConsentProvider,
} from '@wince/consent';

// ---------------------------------------------------------------------------
// Adapter: IStore (unknown-typed get) → MinimalStore (string | null get)
// ---------------------------------------------------------------------------

function toMinimalStore(store: IStore): MinimalStore {
  return {
    get:    (k) => { const v = store.get(k); return typeof v === 'string' ? v : null; },
    set:    (k, v) => store.set(k, v),
    delete: (k) => store.delete(k),
  };
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
}

// ---------------------------------------------------------------------------
// WinceClient
// ---------------------------------------------------------------------------

export class WinceClient {
  private readonly _transport:  Transport;
  private readonly _pipeline:   Pipeline<TrackEvent>;
  private readonly _session:    SessionManager;
  private readonly _identity:   IdentityManager;
  private readonly _seq:        SequenceCounter;
  private readonly _sampler?:   SamplingFilter;
  private readonly _consent:    ConsentProvider | null;
  private _unsubConsent?:       () => void;
  private _removeListeners?:    () => void;

  constructor(config: WinceConfig) {
    const store    = createStore({
      strategies: config.storagePreference ?? ['localStorage', 'sessionStorage', 'cookie', 'memory'],
    });
    const minStore = toMinimalStore(store);

    this._session  = new SessionManager({ idleTimeoutMs: config.sessionIdleTimeoutMs, store: minStore });
    this._identity = new IdentityManager({ store: minStore });
    this._seq      = new SequenceCounter();

    if (config.sampleRate !== undefined && config.sampleRate < 1) {
      this._sampler = new SamplingFilter({ rate: config.sampleRate });
    }

    // Resolve consent provider (undefined → global singleton, null → no gating)
    this._consent = config.consent === undefined ? globalConsent : config.consent;

    this._transport = new Transport({
      url:            config.endpoint,
      compress:       config.compress       ?? true,
      batchSize:      config.batchSize      ?? 20,
      batchTimeoutMs: config.batchTimeoutMs ?? 2_000,
      maxBufferSize:  config.maxBufferSize  ?? 500,
      headers:        config.headers,
      retry:          config.retry,
      fetch:          config.fetch,
      // Start paused when consent is required but not yet granted
      paused: this._consent !== null && !this._consent.isGranted(),
    });

    // React to consent status changes
    if (this._consent !== null) {
      this._unsubConsent = this._consent.onChange((status) => {
        if (status === ConsentStatus.GRANTED) {
          this._transport.start();
        } else {
          this._transport.pause();
        }
      });
    }

    // Custom enrichment / filter hook
    this._pipeline = new Pipeline<TrackEvent>();
    if (config.beforeTrack) {
      this._pipeline.use(config.beforeTrack);
    }

    this._attachListeners();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Track an event. No-op when consent is required but not yet granted.
   * The event is enriched with session, identity, timing, and URL fields
   * before being queued for delivery.
   */
  track(name: string, props?: Record<string, unknown>): void {
    if (this._consent !== null && !this._consent.isGranted()) return;
    if (this._sampler && !this._sampler.shouldTrack(this._identity.getAnonId())) return;

    this._session.touch();

    const raw: TrackEvent = {
      eid:  uuidv7(),
      seq:  this._seq.next(),
      t:    name,
      ts:   Date.now(),
      sid:  this._session.getSid(),
      anon: this._identity.getAnonId(),
      uid:  this._identity.getUserId(),
      props,
      url:  typeof document !== 'undefined' ? document.URL             : undefined,
      ref:  typeof document !== 'undefined' ? (document.referrer || undefined) : undefined,
    };

    const enriched = this._pipeline.run(raw);
    if (enriched) {
      this._transport.send(enriched);
    }
  }

  /** Associate the current device with a known user identity. */
  identify(uid: string): void {
    this._identity.identify(uid);
  }

  /**
   * Reset identity and start a new session.
   * Generates a fresh anonymous ID — call on explicit log-out.
   */
  reset(): void {
    this._identity.reset();
    this._session.reset();
    this._seq.reset();
  }

  /** Grant tracking consent and resume the transport. */
  optIn(): void {
    if (this._consent instanceof ConsentManager) {
      // ConsentManager.optIn() fires onChange(GRANTED) which already calls
      // transport.start() via the listener wired up in the constructor.
      this._consent.optIn();
    } else {
      // Custom or null provider — no onChange fired, so start manually.
      this._transport.start();
    }
  }

  /** Revoke tracking consent and pause the transport. */
  optOut(): void {
    if (this._consent instanceof ConsentManager) {
      // ConsentManager.optOut() fires onChange(DENIED) → transport.pause().
      this._consent.optOut();
    } else {
      this._transport.pause();
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

  // -------------------------------------------------------------------------
  // Browser lifecycle
  // -------------------------------------------------------------------------

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
