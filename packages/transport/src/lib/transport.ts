import { compressSync } from '@wince/compress';
import { Exporter } from './exporter';
import { HttpSender } from './httpSender';
import type { EventPayload, TransportOptions } from './types';

const SCHEMA_VERSION = 1;

function buildEnvelope(batch: EventPayload[]): string {
  const sent_at = Date.now();
  const events = batch.map((e) => {
    const ts = typeof e['ts'] === 'number' ? (e['ts'] as number) : sent_at;
    return { ...e, offset: sent_at - ts, schema_v: SCHEMA_VERSION };
  });
  return JSON.stringify({ sent_at, events });
}

export class Transport {
  private readonly _exporter: Exporter<EventPayload>;
  private readonly _url: string;
  private readonly _useCompression: boolean;

  constructor(opts: TransportOptions) {
    this._url = opts.url;
    this._useCompression = Boolean(opts.compress);

    // When compression is enabled every POST body is gzip'd; declare it upfront
    // in the sender headers so the flag is set on every request.
    const headers: Record<string, string> = { ...opts.headers };
    if (this._useCompression) headers['Content-Encoding'] = 'gzip';

    const sender = new HttpSender({
      endpoint:         opts.url,
      headers,
      requestTimeoutMs: opts.requestTimeoutMs,
      fetch:            opts.fetch,
    });

    this._exporter = new Exporter<EventPayload>({
      sender,
      encode: async (batch) => {
        const payload = buildEnvelope(batch);
        return this._useCompression ? compressSync(payload) : payload;
      },
      batchSize:       opts.batchSize      ?? 10,
      flushIntervalMs: opts.batchTimeoutMs ?? 1_000,
      maxBufferSize:   opts.maxBufferSize  ?? 500,
      retry: {
        attempts:    opts.retry?.attempts,
        baseDelayMs: opts.retry?.baseDelayMs,
        maxDelayMs:  opts.retry?.maxDelayMs,
        factor:      opts.retry?.factor,
        jitter:      opts.retry?.jitter,
      },
      onDropped: opts.onDropped,
      onBatchDelivered: opts.onBatchDelivered
        ? (items) => {
            const eids = items
              .map((e) => (typeof e['eid'] === 'string' ? (e['eid'] as string) : null))
              .filter((id): id is string => id !== null);
            if (eids.length > 0) opts.onBatchDelivered!(eids);
          }
        : undefined,
      priorityFn: opts.eventPriority,
    });

    if (opts.paused) {
      this._exporter.pause();
    }
  }

  send(event: EventPayload): void {
    this._exporter.enqueue(event);
  }

  get queueSize(): number    { return this._exporter.queueSize; }
  get circuitOpen(): boolean { return this._exporter.circuitOpen; }

  /**
   * Resume automatic flushing. Call after consent is confirmed or
   * the network comes back online.
   */
  start(): void {
    this._exporter.start();
  }

  /**
   * Pause automatic flushing. Events added while paused are buffered
   * and will be sent once start() is called.
   */
  pause(): void {
    this._exporter.pause();
  }

  /**
   * Dynamically update batch size and flush interval.
   * Use for network-quality adaptation — call when `navigator.connection.effectiveType` changes.
   */
  updateBatchConfig(batchSize: number, batchTimeoutMs: number): void {
    this._exporter.updateBatchConfig(batchSize, batchTimeoutMs);
  }

  /**
   * Synchronously drain all buffered events via `navigator.sendBeacon`.
   * Call from a `pagehide` listener. No-ops when sendBeacon is unavailable
   * (falls back to a best-effort async flush instead).
   */
  drain(): void {
    const hasBeacon =
      typeof navigator !== 'undefined' &&
      typeof (navigator as Navigator & { sendBeacon?: unknown }).sendBeacon === 'function';

    if (!hasBeacon) {
      void this._exporter.flush().catch(() => { /* best-effort */ });
      return;
    }

    const url = this._url;
    this._exporter.drain({
      encodeSync: (batch) => buildEnvelope(batch),
      send: (data) => {
        const type = typeof data === 'string' ? 'application/json' : 'application/octet-stream';
        (navigator as Navigator & { sendBeacon: (u: string, b: Blob) => boolean })
          .sendBeacon(url, new Blob([data as BlobPart], { type }));
      },
    });
  }

  async flush(): Promise<void> {
    await this._exporter.flush();
  }

  async close(): Promise<void> {
    await this._exporter.close();
  }
}

export default Transport;


