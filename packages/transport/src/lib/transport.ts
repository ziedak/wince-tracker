// import { compressSync } from '@wince/types';
import { Exporter } from './exporter';
import { HttpSender } from './httpSender';
import type { TransportOptions } from './types';
import type { compressAsync } from '@wince/types';
import { BeaconClient } from './beaconClient';
import { HttpClient } from './HttpClient';
import { TrackEventPayload } from '@wince/types';
import { compressAsync as gzipCompressAsync } from '@wince/compress';

const SCHEMA_VERSION = 1;

function buildEnvelope(batch: TrackEventPayload[]): string {
  const sent_at = Date.now();
  const events = batch.map((e) => {
    const ts = e.ts ? (e['ts'] as number) : sent_at;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _priority, ...rest } = e as TrackEventPayload & {
      _priority?: unknown;
    };
    return { ...rest, offset: sent_at - ts, schema_v: SCHEMA_VERSION };
  });
  return JSON.stringify({ sent_at, events });
}

export class Transport {
  private readonly _critical: Exporter<TrackEventPayload>;
  private readonly _high: Exporter<TrackEventPayload>;
  private readonly _normal: Exporter<TrackEventPayload>;
  private readonly _url: string;
  private readonly _useCompression: boolean;

  constructor(opts: TransportOptions) {
    this._url = opts.url;
    
    // Normalize compress option to always be an object
    const compressEnabled = opts.compress === undefined ? true : 
                           typeof opts.compress === 'boolean' ? opts.compress : 
                           opts.compress.enabled;
    this._useCompression = compressEnabled;

    const headers: Record<string, string> = { ...opts.headers };
    if (this._useCompression) headers['Content-Encoding'] = 'gzip';

    const sender = new HttpSender({
      endpoint: opts.url,
      headers,
      requestTimeoutMs: opts.requestTimeoutMs,
      fetch: opts.fetch
    });

    const isCompressObject = (c: boolean | { enabled: boolean; compressFn: compressAsync } | undefined): c is { enabled: boolean; compressFn: compressAsync } => {
      return typeof c === 'object' && c !== null;
    };

    const encode = async (batch: TrackEventPayload[]) => {
      const payload = buildEnvelope(batch);
      const compressObj = isCompressObject(opts.compress) ? opts.compress : { enabled: compressEnabled, compressFn: gzipCompressAsync };
      return this._useCompression ? await compressObj.compressFn(payload) : payload;
    };

    const retryOpts = {
      attempts: opts.retry?.attempts,
      baseDelayMs: opts.retry?.baseDelayMs,
      maxDelayMs: opts.retry?.maxDelayMs,
      factor: opts.retry?.factor,
      jitter: opts.retry?.jitter
    };

    const onDropped = opts.onDropped;
    const onBatchDelivered = opts.onBatchDelivered
      ? (items: TrackEventPayload[]) => {
          const eids = items
            .map((e) => (typeof e['eid'] === 'string' ? (e['eid'] as string) : null))
            .filter((id): id is string => id !== null);
          if (eids.length > 0) opts.onBatchDelivered?.(eids);
        }
      : undefined;

    // ── Critical lane: one event per flush, no hold time. ──────────────────
    // Events with priority='critical' (exit_intent, rage_click, etc.) are
    // sent immediately on enqueue — never batched. Rate-limited to a burst of
    // 10 to prevent storms (e.g. 50 rage-clicks firing 50 requests).
    this._critical = new Exporter<TrackEventPayload>({
      sender,
      encode,
      batchSize: 1,
      flushIntervalMs: 0,
      maxBufferSize: 50,
      rateLimit: { bucketSize: 10, refillRate: 10, refillIntervalMs: 1_000 },
      retry: retryOpts,
      onDropped,
      onBatchDelivered
    });

    // ── High lane: small batches, 2 s flush. ───────────────────────────────
    // purchase, form_abandon, cart add/remove — important but not unload-critical.
    this._high = new Exporter<TrackEventPayload>({
      sender,
      encode,
      batchSize: 5,
      flushIntervalMs: 2_000,
      maxBufferSize: 200,
      retry: retryOpts,
      onDropped,
      onBatchDelivered
    });

    // ── Normal lane: configured batch size + interval. ─────────────────────
    // All other events — scroll depth, clicks, page_view, etc.
    this._normal = new Exporter<TrackEventPayload>({
      sender,
      encode,
      batchSize: opts.batchSize ?? 10,
      flushIntervalMs: opts.batchTimeoutMs ?? 5_000,
      maxBufferSize: opts.maxBufferSize ?? 500,
      retry: retryOpts,
      onDropped,
      onBatchDelivered
    });

    if (opts.paused) {
      this._critical.pause();
      this._high.pause();
      this._normal.pause();
    }
  }

  /**
   * Route an event to the appropriate priority lane.
   * The `_priority` field (stamped by WinceClient) controls routing:
   *   - `'critical'` → critical lane (immediate flush)
   *   - `'high'`     → high lane (2 s flush)
   *   - anything else → normal lane (configured flush interval)
   */
  send(event: TrackEventPayload): void {
    const priority = event._priority;
    if (priority === 'critical') {
      this._critical.enqueue(event);
    } else if (priority === 'high') {
      this._high.enqueue(event);
    } else {
      this._normal.enqueue(event);
    }
  }

  get queueSize(): number {
    return this._critical.queueSize + this._high.queueSize + this._normal.queueSize;
  }

  get circuitOpen(): boolean {
    return this._critical.circuitOpen || this._high.circuitOpen || this._normal.circuitOpen;
  }

  /**
   * Resume automatic flushing on all lanes. Call after consent is confirmed or
   * the network comes back online.
   */
  start(): void {
    this._critical.start();
    this._high.start();
    this._normal.start();
  }

  /**
   * Pause automatic flushing on all lanes. Events added while paused are
   * buffered and will be sent once start() is called.
   */
  pause(): void {
    this._critical.pause();
    this._high.pause();
    this._normal.pause();
  }

  /**
   * Dynamically update the normal-lane batch size and flush interval.
   * Critical and high lanes have fixed configs and are unaffected.
   */
  updateBatchConfig(batchSize: number, batchTimeoutMs: number): void {
    this._normal.updateBatchConfig(batchSize, batchTimeoutMs);
  }

  /**
   * Synchronously drain all lanes via `navigator.sendBeacon`.
   * Drains critical first, then high, then normal so the most important
   * events are packed into the earliest beacons.
   * Call from a `pagehide` listener. Falls back to best-effort async flush
   * when sendBeacon is unavailable.
   */
  drain(): void {
    const hasBeacon =
      typeof navigator !== 'undefined' &&
      typeof (navigator as Navigator & { sendBeacon?: unknown }).sendBeacon === 'function';

    if (!hasBeacon) {
      void Promise.all([this._critical.flush(), this._high.flush(), this._normal.flush()]).catch(
        () => {
          /* best-effort */
        }
      );
      return;
    }

    const url = this._url;
    const drainOpts = {
      encodeSync: (batch: TrackEventPayload[]) => buildEnvelope(batch),
      send: (data: string | Uint8Array) => {
        const type = typeof data === 'string' ? 'application/json' : 'application/octet-stream';
        (
          navigator as Navigator & {
            sendBeacon: (u: string, b: Blob) => boolean;
          }
        ).sendBeacon(url, new Blob([data as BlobPart], { type }));
      }
    };

    // Priority order: critical → high → normal.
    this._critical.drain(drainOpts);
    this._high.drain(drainOpts);
    this._normal.drain(drainOpts);
  }

  async flush(): Promise<void> {
    await Promise.all([this._critical.flush(), this._high.flush(), this._normal.flush()]);
  }

  async close(): Promise<void> {
    await Promise.all([this._critical.close(), this._high.close(), this._normal.close()]);
  }
}

export default Transport;

/**
 * Create a default Transport instance for browser usage.
 * Uses BeaconClient with a Fetch fallback and enables compression by default.
 */
export function createDefaultTransport(url: string, opts?: Partial<TransportOptions>) {
  const client = new BeaconClient(new HttpClient());
  const transport = new Transport({
    url,
    compress: opts?.compress ?? true,
    client,
    batchSize: opts?.batchSize,
    batchTimeoutMs: opts?.batchTimeoutMs,
    headers: opts?.headers,
    retry: opts?.retry
  } as TransportOptions);
  return transport;
}

export function createClientTransport(opts: TransportOptions): Transport {
  return new Transport({
    url: opts.url,
    compress: opts.compress ?? true,
    batchSize: opts.batchSize ?? 20,
    batchTimeoutMs: opts.batchTimeoutMs ?? 5_000,
    maxBufferSize: opts.maxBufferSize ?? 500,
    headers: opts.headers,
    retry: opts.retry,
    fetch: opts.fetch,
    paused: opts.paused ?? true,
    onDropped: opts.onDropped,
    onBatchDelivered: opts.onBatchDelivered
  });
}
