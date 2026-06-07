import { compressSync } from '@wince/compress';
import { Exporter } from './exporter';
import { HttpSender } from './httpSender';
import type { EventPayload, TransportOptions } from './types';

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
        const payload = JSON.stringify(batch);
        // compressSync accepts strings directly — no need to pre-encode to Uint8Array.
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
    });

    if (opts.paused) {
      this._exporter.pause();
    }
  }

  send(event: EventPayload): void {
    this._exporter.enqueue(event);
  }

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
      encodeSync: (batch) => JSON.stringify(batch),
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


