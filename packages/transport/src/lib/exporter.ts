import { BatchQueue } from './batchQueue';
import { type HttpSender } from './httpSender';
import { TokenBucketRateLimiter, type TokenBucketOptions } from './rateLimiter';
import { backoffDelay } from './retry';
import { safeSetTimeout } from './safeSetTimeout';

// ============================================================================
// Types
// ============================================================================

export interface ExporterRetryOptions {
  /** Total attempts including the first. Default: 4 */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?:  number;
  factor?:      number;
  jitter?:      boolean;
}

export interface ExporterOptions<T> {
  /**
   * Serialise a batch of items into the HTTP request body.
   * May be async — useful for compression (e.g. gzip) before sending.
   */
  encode: (batch: T[]) => string | Uint8Array | Promise<string | Uint8Array>;

  /** Pre-built HttpSender (owns endpoint, headers, timeout, fetch). */
  sender: HttpSender;

  /** Max items per HTTP request. Default: 100 */
  batchSize?: number;

  /**
   * Max encoded bytes per HTTP request.
   * The Exporter will use the smaller of `batchSize` and `batchBytes` constraints.
   * Default: unlimited.
   */
  batchBytes?: number;

  /** Flush interval (ms). Backed off by circuit breaker. Default: 5 000 */
  flushIntervalMs?: number;

  /** Max items held in memory. Oldest is dropped when full. Default: 500 */
  maxBufferSize?: number;

  /** Retry behaviour for transient errors. Default: 4 attempts, exp backoff + jitter. */
  retry?: ExporterRetryOptions;

  /** Optional token-bucket rate limit applied before each item is enqueued. */
  rateLimit?: TokenBucketOptions;

  /**
   * If provided, matching items bypass the batch buffer and are sent immediately
   * as a single-item HTTP request. Use for ERROR/FATAL priority flushing.
   */
  onPriorityItem?: (item: T) => boolean;

  /**
   * Optional byte-size estimator for a single item.
   * Required for accurate `batchBytes` enforcement; falls back to JSON.stringify length.
   */
  sizeOf?: (item: T) => number;
}

// ============================================================================
// Circuit breaker state
// ============================================================================

const CB_THRESHOLD   = 3;    // consecutive failures before backing off
const CB_MAX_FACTOR  = 10;   // max multiplier on flushIntervalMs

// ============================================================================
// Exporter
// ============================================================================

export class Exporter<T> {
  private readonly _encode:          (batch: T[]) => string | Uint8Array | Promise<string | Uint8Array>;
  private readonly _sender:          HttpSender;
  private readonly _baseFlushMs:     number;
  private readonly _retryOpts:       Required<ExporterRetryOptions>;
  private readonly _rateLimiter?:    TokenBucketRateLimiter;
  private readonly _queue:           BatchQueue<T>;
  private readonly _drainBatchSize:  number;

  // Circuit breaker
  private _consecutiveFailures = 0;
  private _cbOpen             = false;
  private _cbTimer?: ReturnType<typeof setTimeout>;

  constructor(opts: ExporterOptions<T>) {
    this._encode      = opts.encode;
    this._sender      = opts.sender;
    this._baseFlushMs = opts.flushIntervalMs ?? 5_000;

    this._retryOpts = {
      attempts:   opts.retry?.attempts   ?? 4,
      baseDelayMs: opts.retry?.baseDelayMs ?? 200,
      maxDelayMs:  opts.retry?.maxDelayMs  ?? 30_000,
      factor:      opts.retry?.factor      ?? 2,
      jitter:      opts.retry?.jitter      ?? true,
    };

    this._drainBatchSize = opts.batchSize ?? 100;

    if (opts.rateLimit) {
      this._rateLimiter = new TokenBucketRateLimiter(opts.rateLimit);
    }

    this._queue = new BatchQueue<T>(
      (batch) => this._sendBatch(batch),
      {
        batchSize:       opts.batchSize     ?? 100,
        batchBytes:      opts.batchBytes,
        flushIntervalMs: this._baseFlushMs,
        maxBufferSize:   opts.maxBufferSize  ?? 500,
        onPriorityItem:  opts.onPriorityItem,
        sizeOf:          opts.sizeOf,
      },
    );
  }

  enqueue(item: T): void {
    if (this._rateLimiter && !this._rateLimiter.consume()) {
      return; // rate-limited, drop
    }
    this._queue.add(item);
  }

  /** Pause automatic flushing (e.g. consent not yet granted, or user offline). */
  pause(): void {
    this._queue.pause();
  }

  /** Resume automatic flushing. */
  start(): void {
    this._queue.start();
  }

  async flush(): Promise<void> {
    return this._queue.flush();
  }

  async close(): Promise<void> {
    this._clearCbTimer();
    this._queue.close();
    await this._queue.flush().catch(() => { /* best-effort on shutdown */ });
  }

  /**
   * Synchronously drain all buffered items and send them via the provided
   * callbacks. Intended for `pagehide` / page-unload scenarios where only
   * synchronous fire-and-forget APIs (sendBeacon) are available.
   *
   * @param opts.encodeSync  - Synchronous encoder (e.g. JSON.stringify or compressSync)
   * @param opts.send        - Fire-and-forget sender (e.g. navigator.sendBeacon wrapper)
   */
  drain(opts: {
    encodeSync: (batch: T[]) => string | Uint8Array;
    send: (data: string | Uint8Array) => void;
  }): void {
    const items = this._queue.drain();
    if (items.length === 0) return;
    for (let i = 0; i < items.length; i += this._drainBatchSize) {
      const batch = items.slice(i, i + this._drainBatchSize);
      try {
        const body = opts.encodeSync(batch);
        opts.send(body);
      } catch { /* best-effort — beacon is fire-and-forget */ }
    }
  }

  // --------------------------------------------------------------------------
  // Core send logic
  // --------------------------------------------------------------------------

  private async _sendBatch(batch: T[]): Promise<void> {
    // Circuit open — throw so BatchQueue._flushCycle retains items in the buffer.
    if (this._cbOpen) throw new Error('[Exporter] circuit open — flush deferred');

    let currentBatch = batch;
    let attempt = 0;
    const { attempts, baseDelayMs, maxDelayMs, factor, jitter } = this._retryOpts;

    // Cache the encoded body; invalidated only when `currentBatch` is replaced (too-large halving).
    let body: string | Uint8Array | undefined;

    while (attempt < attempts) {
      if (body === undefined) {
        body = await this._encode(currentBatch);
      }
      const outcome = await this._sender.send(body);

      switch (outcome.kind) {
        case 'ok':
          this._onSuccess();
          return;

        case 'too-large':
          if (currentBatch.length === 1) {
            // Single oversized record — drop to avoid infinite loop
            console.warn('[Exporter] dropping oversized single record (too-large)');
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
          if (attempt >= attempts) {
            this._onFailure(); // count once per complete batch exhaustion, not per attempt
            break;
          }

          const delay = outcome.retryAfterMs != null
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
      Math.log2(CB_MAX_FACTOR),
    );
    // exponent is capped at log2(CB_MAX_FACTOR), so 2^exponent ≤ CB_MAX_FACTOR — outer min redundant.
    const backoffMs = this._baseFlushMs * Math.pow(2, exponent);
    this._cbTimer = safeSetTimeout(() => {
      this._cbTimer = undefined;
      this._cbOpen = false; // close circuit — allow one probe flush through
      void this._queue.flush().catch(() => {});
    }, backoffMs);
  }

  private _clearCbTimer(): void {
    if (this._cbTimer !== undefined) {
      clearTimeout(this._cbTimer);
      this._cbTimer = undefined;
    }
  }

  get queueSize(): number { return this._queue.size; }
}
