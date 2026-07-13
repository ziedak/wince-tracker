import { Exporter } from './exporter';
import { HttpSender } from './httpSender';
import { DEFAULT_TRANSPORT_OPTIONS, type TransportOptions } from './types';
import { BeaconClient } from './clients/beaconClient';
import { EventPriority, TrackEventPayload } from '@wince/types';
import { HttpClient } from './clients/HttpClient';
import { WebSocketClient } from './clients/WebSocketClient';
import { IHttpClient } from './clients/IHttpClient';
import { NoPClient } from './clients/NoPCLient';

export interface ITransport {
  queueSize: number;
  circuitOpen: boolean;
  send(event: TrackEventPayload): void;
  start(): void;
  pause(): void;
  updateBatchConfig(batchSize: number, batchTimeoutMs: number): void;
  drain(): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export class Transport<T extends TrackEventPayload> implements ITransport {
  private readonly _critical: Exporter<T>;
  private readonly _high: Exporter<T>;
  private readonly _normal: Exporter<T>;
  private readonly _url: string;
  private readonly _useCompression: boolean;

  constructor(client: IHttpClient, opts: TransportOptions<T>) {
    this._url = opts.url;

    this._useCompression = opts.compress.enabled;

    let headers: HeadersInit = opts.headers;
    if (this._useCompression) headers = { 'Content-Encoding': 'gzip', ...opts.headers };

    const sender = new HttpSender(client, {
      endpoint: opts.url,
      headers,
      requestTimeoutMs: opts.requestTimeoutMs
    });

    // ── Critical lane: one event per flush, no hold time. ──────────────────
    // Events with priority='critical' (exit_intent, rage_click, etc.) are
    // sent immediately on enqueue — never batched. Rate-limited to a burst of
    // 10 to prevent storms (e.g. 50 rage-clicks firing 50 requests).
    this._critical = new Exporter<T>(sender, opts.exporterOpts.critical);

    // ── High lane: small batches, 2 s flush. ───────────────────────────────
    // purchase, form_abandon, cart add/remove — important but not unload-critical.
    this._high = new Exporter<T>(sender, opts.exporterOpts.high);

    // ── Normal lane: configured batch size + interval. ─────────────────────
    // All other events — scroll depth, clicks, page_view, etc.
    this._normal = new Exporter<T>(sender, opts.exporterOpts.normal);

    if (opts.paused) {
      this._critical.pause();
      this._high.pause();
      this._normal.pause();
    }
  }

  /**
   * Route an event to the appropriate priority lane.
   * The `priority` field (stamped by WinceClient) controls routing:
   *   - `EventPriority.Critical` → critical lane (immediate flush)
   *   - `EventPriority.High`     → high lane (2 s flush)
   *   - `EventPriority.Normal`   → normal lane (configured flush interval)
   */
  send(event: T): void {
    const priority = event.priority;
    if (priority === EventPriority.Critical) {
      this._critical.enqueue(event);
    } else if (priority === EventPriority.High) {
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

    // Priority order: critical → high → normal.
    this._critical.drain(this._url);
    this._high.drain(this._url);
    this._normal.drain(this._url);
  }

  async flush(): Promise<void> {
    await Promise.all([this._critical.flush(), this._high.flush(), this._normal.flush()]);
  }

  async close(): Promise<void> {
    await Promise.all([this._critical.close(), this._high.close(), this._normal.close()]);
  }
}

export default Transport;

export function createClientTransport<T extends TrackEventPayload>(
  opts: TransportOptions<T>
): Transport<T> {
  const beaconClient = new BeaconClient();
  const httpClient = new HttpClient(opts.headers, beaconClient);
  const webSocketClient = new WebSocketClient(
    {
      url: opts.wsUrl,
      ackTimeoutMs: 5_000
    },
    httpClient
  );
  const transportOpts: TransportOptions<T> = { ...DEFAULT_TRANSPORT_OPTIONS, ...opts };

  const transport = new Transport(webSocketClient, transportOpts);
  return transport;
}

export const noPClient = new NoPClient();
