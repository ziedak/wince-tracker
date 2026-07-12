import { serialize } from '@wince/utils';
import { approximateBytes, BatchQueue, BatchQueueOptions } from './batchQueue';
import { type HttpSender } from './httpSender';
import { TokenBucketRateLimiter, type TokenBucketOptions } from './rateLimiter';
import { backoffDelay, WithRetriesOptions } from './retry';
import { safeSetTimeout } from './safeSetTimeout';
import { TrackEventPayload } from '@wince/types';
// import type { DropReason } from './types';

// export const DEFAULT_EXPORTER_OPTIONS: Partial<ExporterOptions<unknown>> = {
//   retry: DEFAULT_RETRY_OPTIONS,
//   rateLimit: DEFAULT_TOKEN_BUCKET_OPTIONS,
//   batch: DEFAULT_BATCH_QUEUE_OPTS
// };

// ============================================================================
// Types
// ============================================================================

export interface ExporterOptions<T> {
  schemaVersion: number;
  /** Max items per HTTP request. Default: 100 */
  // batchSize?: number;

  /**
   * Max encoded bytes per HTTP request.
   * The Exporter will use the smaller of `batchSize` and `batchBytes` constraints.
   * Default: unlimited.
   */
  // batchBytes?: number;

  /** Flush interval (ms). Backed off by circuit breaker. Default: 5 000 */
  // flushIntervalMs?: number;

  /** Max items held in memory. Oldest is dropped when full. Default: 500 */
  // maxBufferSize?: number;

  /** Retry behaviour for transient errors. Default: 4 attempts, exp backoff + jitter. */
  retry: WithRetriesOptions;

  /** Optional token-bucket rate limit applied before each item is enqueued. */
  rateLimit: TokenBucketOptions;
  batch: BatchQueueOptions<T>;
  /**
   * Serialise a batch of items into the HTTP request body.
   * May be async — useful for compression (e.g. gzip) before sending.
   */

  compressFn: (input: string | ArrayBuffer | Uint8Array<ArrayBufferLike>) => Promise<Uint8Array>;

  /**
   * If provided, matching items bypass the batch buffer and are sent immediately
   * as a single-item HTTP request. Use for ERROR/FATAL priority flushing.
   */
  // onPriorityItem?: (item: T) => boolean;

  /**
   * Optional byte-size estimator for a single item.
   * Required for accurate `batchBytes` enforcement; falls back to JSON.stringify length.
   */
  // sizeOf?: (item: T) => number;
  /** Called when an event is lost or blocked from delivery. */
  // onDropped?: (reason: DropReason, item?: T) => void;
  /** Called after a batch is successfully delivered. */
  onBatchDelivered: (eids: string[]) => void;
  /**
   * Priority scorer for drain-time sorting.
   * Higher scores are packed into beacons first. Items with equal scores
   * maintain their original buffer order. Omit to keep insertion order.
   */
  // priorityFn?: (item: T) => number;
}

// ============================================================================
// Circuit breaker state
// ============================================================================

const CB_THRESHOLD = 3; // consecutive failures before backing off
const CB_MAX_FACTOR = 10; // max multiplier on flushIntervalMs

// ============================================================================
// Beacon packing constants
// ============================================================================

/** Conservative byte budget per beacon pass — stays below the 64 KB sendBeacon limit. */
const BEACON_BYTE_BUDGET = 60_000;
/** Estimated envelope overhead: `{"sent_at":1234567890123,"events":[]}` */
const BEACON_BYTE_BUDGET_OVERHEAD = 50;

// ============================================================================
// Exporter
// ============================================================================

export class Exporter<T extends TrackEventPayload> {
  /** Pre-built HttpSender (owns endpoint, headers, timeout, fetch). */

  private readonly _sender: HttpSender;
  private readonly _baseFlushMs: number;
  private readonly _retryOpts: WithRetriesOptions;
  private readonly _rateLimiter?: TokenBucketRateLimiter;
  private readonly _queue: BatchQueue<T>;

  private readonly _onBatchDelivered: (eids: string[]) => void;
  // private readonly _onDropped?: (reason: DropReason, item?: T) => void;

  // private readonly _priorityFn?: (item: T) => number;

  // Circuit breaker
  private _consecutiveFailures = 0;
  private _cbOpen = false;
  private _cbTimer?: ReturnType<typeof setTimeout>;

  // Velocity-adaptive batch config
  private _extBatchSize: number; // batch size set by external callers (network quality)
  private _extFlushMs: number; // flush interval set by external callers
  private _lastEnqueueAt = 0; // ms timestamp of the most recent enqueue
  private _eventVelocity = 0; // EMA of events/second (α = 0.2)
  private _velTier: 0 | 1 | 2 = 0; // 0 = base, 1 = medium (1–5 /s), 2 = fast (> 5 /s)
  private _compressFn: (
    input: string | ArrayBuffer | Uint8Array<ArrayBufferLike>
  ) => Promise<Uint8Array>;
  private readonly _schemaVersion: number;

  constructor(sender: HttpSender, opts: ExporterOptions<T>) {
    this._sender = sender;
    this._baseFlushMs = opts.batch.flushIntervalMs ?? 5_000;
    this._retryOpts = opts.retry;
    this._schemaVersion = opts.schemaVersion;

    //this._onDropped = opts.onDropped;
    this._onBatchDelivered = opts.onBatchDelivered;
    this._compressFn = opts.compressFn;

    if (opts.rateLimit) {
      this._rateLimiter = new TokenBucketRateLimiter(opts.rateLimit);
    }

    const batchOpts: BatchQueueOptions<T> = {
      ...opts.batch,
      sendFn: (batch) => this._sendBatch(batch)
    };
    this._queue = new BatchQueue<T>(batchOpts);

    // Seed external baseline so velocity tier 0 restores the right values.
    this._extBatchSize = batchOpts.batchSize ?? 100;
    this._extFlushMs = batchOpts.flushIntervalMs ?? 5_000;
  }

  enqueue(item: T): void {
    if (this._rateLimiter && !this._rateLimiter.consume()) {
      this._queue.onDropped('rate_limit', item);
      return; // rate-limited, drop
    }
    this._trackVelocity();
    this._queue.add(item);
  }

  get queueSize(): number {
    return this._queue.size;
  }
  get circuitOpen(): boolean {
    return this._cbOpen;
  }

  /** Pause automatic flushing (e.g. consent not yet granted, or user offline). */
  pause(): void {
    this._queue.pause();
  }

  /** Resume automatic flushing. */
  start(): void {
    this._queue.start();
  }

  /**
   * Dynamically update batch size and flush interval (e.g. on network-quality change).
   * Stored as the baseline; applied immediately unless a velocity tier is active,
   * in which case it takes effect when traffic slows back to the base tier.
   */
  updateBatchConfig(batchSize: number, flushIntervalMs: number): void {
    this._extBatchSize = batchSize;
    this._extFlushMs = flushIntervalMs;
    if (this._velTier === 0) {
      this._queue.updateConfig(batchSize, flushIntervalMs);
    }
  }

  async flush(): Promise<void> {
    return this._queue.flush();
  }

  async close(): Promise<void> {
    this._clearCbTimer();
    this._queue.close();
    await this._queue.flush().catch(() => {
      /* best-effort on shutdown */
    });
  }

  /**
   * Synchronously drain all buffered items and send them via the provided
   * callbacks. Intended for `pagehide` / page-unload scenarios where only
   * synchronous fire-and-forget APIs (sendBeacon) are available.
   *
   * When `priorityFn` is set, items are sorted by priority (descending) before
   * packing. Items are then packed greedily up to `BEACON_BYTE_BUDGET` bytes per
   * beacon, with at most two beacons sent.
   *
   * @param opts.encodeSync  - Synchronous encoder (e.g. JSON.stringify or compressSync)
   * @param opts.send        - Fire-and-forget sender (e.g. navigator.sendBeacon wrapper)
   */
  drain(
    url: string,
    // batch: T[]
    //encodeSync: (batch: T[]) => string | Uint8Array;
  ): void {
    const items = this._queue.drain();
    if (items.length === 0) return;

    // if (this._priorityFn) {
    //   const fn = this._priorityFn;
    //   // Stable sort: items with equal priority keep their original order.
    //   items = items
    //     .map((item, i) => ({ item, pri: fn(item), i }))
    //     .sort((a, b) => b.pri - a.pri || a.i - b.i)
    //     .map(({ item }) => item);
    // }

    // Greedy packing — at most two beacon passes.
    let remaining = items;
    for (let pass = 0; pass < 2 && remaining.length > 0; pass++) {
      const batch: T[] = [];
      let approxBytes = BEACON_BYTE_BUDGET_OVERHEAD;

      for (const item of remaining) {
        const itemBytes = approximateBytes(item) + (batch.length > 0 ? 1 : 0); // comma
        if (batch.length > 0 && approxBytes + itemBytes > BEACON_BYTE_BUDGET) break;
        batch.push(item);
        approxBytes += itemBytes;
      }

      try {
        const body = this._buildEnvelope(batch);
        this._sendImmediate(url, body);
      } catch {
        /* best-effort — beacon is fire-and-forget */
      }

      remaining = remaining.slice(batch.length);
    }
  }

  // --------------------------------------------------------------------------
  // Core send logic
  // --------------------------------------------------------------------------

  private async _sendBatch(batch: T[]): Promise<void> {
    // Circuit open — throw so BatchQueue._flushCycle retains items in the buffer.
    // Do NOT call onDropped here: items are deferred, not permanently lost.
    if (this._cbOpen) throw new Error('[Exporter] circuit open — flush deferred');

    let currentBatch = batch;
    let attempt = 0;
    const { baseDelayMs, maxDelayMs, factor, jitter } = this._retryOpts.delayOpts;

    // Cache the encoded body; invalidated only when `currentBatch` is replaced (too-large halving).
    let body: string | Uint8Array | undefined;

    while (attempt < this._retryOpts.maxAttempts) {
      if (body === undefined) {
        body = await this._encode(currentBatch);
      }
      const outcome = await this._sender.send(body);

      switch (outcome.kind) {
        case 'ok':
          this._onSuccess();
          this._batchDelivered(currentBatch);
          return;

        case 'too-large':
          if (currentBatch.length === 1) {
            // Single oversized record — drop to avoid infinite loop
            console.warn('[Exporter] dropping oversized single record (too-large)');
            this._queue.onDropped('too_large', currentBatch[0]);
            this._onSuccess(); // treat as consumed
            return;
          }
          // Halve batch, retry immediately (no backoff delay)
          currentBatch = currentBatch.slice(0, Math.max(1, Math.floor(currentBatch.length / 2)));
          body = undefined; // batch changed — must re-encode
          continue;

        case 'fatal':
          // Non-retryable — drop the batch
          console.warn(`[Exporter] dropping batch: fatal HTTP ${outcome.status}`);
          this._onSuccess(); // treat as consumed (no point retrying)
          return;

        case 'retry': {
          attempt++;
          if (attempt >= this._retryOpts.maxAttempts) {
            this._onFailure(); // count once per complete batch exhaustion, not per attempt
            break;
          }

          const delay =
            outcome.retryAfterMs != null
              ? outcome.retryAfterMs
              : backoffDelay(attempt - 1, { baseDelayMs, maxDelayMs, factor, jitter });

          await new Promise<void>((res) => safeSetTimeout(res, delay));
          continue;
        }
      }
    }

    // Exhausted retries — throw so BatchQueue retains items in its buffer for the next cycle.
    throw new Error('[Exporter] send failed after maximum retry attempts');
  }

  private _buildEnvelope(batch: TrackEventPayload[]): string {
    const sent_at = Date.now();
    const events = batch.map((e) => {
      const ts = e.ts ? e.ts : sent_at;
      return { ...e, offset: sent_at - ts, schema_v: this._schemaVersion };
    });
    return serialize({ sent_at, events });
  }

  private async _encode(currentBatch: T[]): Promise<string | Uint8Array<ArrayBufferLike>> {
    const payload = this._buildEnvelope(currentBatch);
    return this._compressFn ? await this._compressFn(payload) : payload;
  }

  private _sendImmediate(url: string, data: string | Uint8Array) {
    const type = typeof data === 'string' ? 'application/json' : 'application/octet-stream';
    (
      navigator as Navigator & {
        sendBeacon: (u: string, b: Blob) => boolean;
      }
    ).sendBeacon(url, new Blob([data as BlobPart], { type }));
  }

  // --------------------------------------------------------------------------
  // Circuit breaker
  // --------------------------------------------------------------------------

  private _onSuccess(): void {
    if (this._consecutiveFailures > 0) {
      this._consecutiveFailures = 0;
      this._cbOpen = false;
      this._clearCbTimer();
      this._rateLimiter?.reset();
    }
  }

  private _onFailure(): void {
    this._consecutiveFailures++;
    if (this._consecutiveFailures >= CB_THRESHOLD) {
      this._cbOpen = true;
      this._armCbBackoff();
    }
  }

  /**
   * Back off the flush interval exponentially, capped at 10× the base value.
   * The circuit breaker timer runs in the background; when it fires the queue
   * resumes normal periodic flushing at the current (backed-off) interval.
   */
  private _armCbBackoff(): void {
    this._clearCbTimer();
    // +1 so the first trigger (consecutiveFailures === CB_THRESHOLD) starts at 2× base, not 1×.
    const exponent = Math.min(
      this._consecutiveFailures - CB_THRESHOLD + 1,
      Math.log2(CB_MAX_FACTOR)
    );
    // exponent is capped at log2(CB_MAX_FACTOR), so 2^exponent ≤ CB_MAX_FACTOR — outer min redundant.
    const backoffMs = this._baseFlushMs * Math.pow(2, exponent);
    this._cbTimer = safeSetTimeout(() => {
      this._cbTimer = undefined;
      this._cbOpen = false; // close circuit — allow one probe flush through
      void this._queue.flush().catch((error) => {
        void error;
      });
    }, backoffMs);
  }

  private _clearCbTimer(): void {
    if (this._cbTimer !== undefined) {
      clearTimeout(this._cbTimer);
      this._cbTimer = undefined;
    }
  }

  /**
   * Exponential moving average of event velocity (α = 0.2, events/second).
   * When the tier changes, batch size AND flush interval are updated together
   * so that high-velocity sessions flush small batches quickly while low-velocity
   * sessions use the externally-configured (network-quality) baseline.
   *
   * Tiers:
   *   2 — fast  (> 5 /s)  → batchSize = 5,  flushIntervalMs =   500
   *   1 — medium (1–5 /s) → batchSize = 10, flushIntervalMs = 1 000
   *   0 — base  (< 1 /s)  → externally-set values (_extBatchSize / _extFlushMs)
   */
  private _trackVelocity(): void {
    const now = Date.now();
    if (this._lastEnqueueAt > 0) {
      const dtSec = Math.max((now - this._lastEnqueueAt) / 1_000, 0.001);
      this._eventVelocity = 0.2 * (1 / dtSec) + 0.8 * this._eventVelocity;
    }
    this._lastEnqueueAt = now;

    const tier: 0 | 1 | 2 = this._eventVelocity > 5 ? 2 : this._eventVelocity > 1 ? 1 : 0;
    if (tier === this._velTier) return;
    this._velTier = tier;

    const [bs, fi] =
      tier === 2
        ? [Math.min(this._extBatchSize, 5), 500]
        : tier === 1
          ? [Math.min(this._extBatchSize, 10), 1_000]
          : [this._extBatchSize, this._extFlushMs];
    this._queue.updateConfig(bs, fi);
  }

  private _batchDelivered(batch: T[]): void {
    const eids = batch.map((e) => (e.eid ? e.eid : null)).filter((id): id is string => id !== null);
    if (eids.length > 0) this._onBatchDelivered(eids);
  }
}
