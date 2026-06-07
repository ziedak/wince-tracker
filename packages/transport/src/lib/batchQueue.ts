import { safeSetTimeout } from './safeSetTimeout';

export interface BatchQueueOptions<T> {
  /** Flush when buffer reaches this many items. Default: 20 */
  batchSize?: number;
  /** Flush when total encoded bytes would exceed this. Default: unlimited */
  batchBytes?: number;
  /** Periodic flush interval (ms). Default: 5000 */
  flushIntervalMs?: number;
  /** Max items held in memory; oldest is dropped when full. Default: 500 */
  maxBufferSize?: number;
  /**
   * When provided, items matching this predicate bypass the batch buffer and
   * are passed to `sendFn` immediately as a single-item batch.
   * Used for ERROR/FATAL priority flushing.
   */
  onPriorityItem?: (item: T) => boolean;
  /**
   * Optional byte-size estimator for an item.
   * Required when `batchBytes` is set. Falls back to rough JSON.stringify length.
   */
  sizeOf?: (item: T) => number;
}

type SendFn<T> = (batch: T[]) => Promise<void>;

function defaultSizeOf<T>(item: T): number {
  try { return JSON.stringify(item).length; } catch { return 0; }
}

export class BatchQueue<T> {
  private readonly _sendFn:        SendFn<T>;
  private readonly _batchSize:     number;
  private readonly _batchBytes:    number;
  private readonly _flushIntervalMs: number;
  private readonly _maxBufferSize: number;
  private readonly _onPriorityItem?: (item: T) => boolean;
  private readonly _sizeOf:        (item: T) => number;

  private _buffer:       T[] = [];
  private _bufferBytes   = 0;
  private _flushTimer?:  ReturnType<typeof setTimeout>;
  private _flushPromise: Promise<void> | null = null;
  private _paused        = false;

  constructor(sendFn: SendFn<T>, opts: BatchQueueOptions<T> = {}) {
    this._sendFn          = sendFn;
    this._batchSize       = opts.batchSize       ?? 20;
    this._batchBytes      = opts.batchBytes       ?? Infinity;
    this._flushIntervalMs = opts.flushIntervalMs  ?? 5000;
    this._maxBufferSize   = opts.maxBufferSize    ?? 500;
    this._onPriorityItem  = opts.onPriorityItem;
    this._sizeOf          = opts.sizeOf           ?? defaultSizeOf;
  }

  add(item: T): void {
    // Priority items bypass the batch entirely
    if (this._onPriorityItem?.(item)) {
      void this._sendImmediate(item);
      return;
    }

    // Drop oldest if buffer is full
    if (this._buffer.length >= this._maxBufferSize) {
      const dropped = this._buffer.shift()!;
      this._bufferBytes -= this._sizeOf(dropped);
    }

    this._buffer.push(item);
    this._bufferBytes += this._sizeOf(item);

    // While paused: buffer items but never auto-flush or arm the timer.
    if (this._paused) return;

    if (
      this._buffer.length >= this._batchSize ||
      this._bufferBytes   >= this._batchBytes
    ) {
      this._flushInBackground();
    } else {
      this._armTimer();
    }
  }

  /**
   * Flush all buffered items. Concurrent calls are serialised — a second call
   * waits for the first to finish, then issues a second flush for anything that
   * arrived in between. Only items present at the START of each flush cycle are
   * sent; items written during the flush are deferred to the next cycle.
   */
  async flush(): Promise<void> {
    if (this._flushPromise) return this._flushPromise;
    this._flushPromise = this._flushCycle().finally(() => {
      this._flushPromise = null;
    });
    return this._flushPromise;
  }

  private async _flushCycle(): Promise<void> {
    this._clearTimer();
    // originalLength sentinel: only process what is in the buffer RIGHT NOW.
    const originalLength = this._buffer.length;
    let sent = 0;

    while (sent < originalLength && this._buffer.length > 0) {
      const remaining = originalLength - sent;
      let batchSize = Math.min(remaining, this._batchSize);

      // Byte-budget enforcement: shrink batch to fit batchBytes
      if (this._batchBytes < Infinity) {
        let bytes = 0;
        let n = 0;
        for (const item of this._buffer) {
          if (n >= batchSize) break;
          const s = this._sizeOf(item);
          if (n > 0 && bytes + s > this._batchBytes) break;
          bytes += s;
          n++;
        }
        batchSize = Math.max(1, n);
      }

      const batch = this._buffer.slice(0, batchSize);
      await this._sendFn(batch);
      this._buffer = this._buffer.slice(batchSize);
      this._bufferBytes -= batch.reduce((acc, item) => acc + this._sizeOf(item), 0);
      sent += batchSize;
    }
  }

  private async _sendImmediate(item: T): Promise<void> {
    try {
      await this._sendFn([item]);
    } catch (err) {
      try { console.error('[BatchQueue] priority send failed', err); } catch { /* swallow */ }
    }
  }

  private _armTimer(): void {
    if (this._flushTimer !== undefined) return;
    this._flushTimer = safeSetTimeout(() => {
      this._flushTimer = undefined;
      this._flushInBackground();
    }, this._flushIntervalMs);
  }

  private _clearTimer(): void {
    if (this._flushTimer !== undefined) {
      clearTimeout(this._flushTimer);
      this._flushTimer = undefined;
    }
  }

  private _flushInBackground(): void {
    void this.flush().catch((err) => {
      try { console.error('[BatchQueue] flush error', err); } catch { /* swallow */ }
    });
  }

  close(): void {
    this._clearTimer();
  }

  /**
   * Pause automatic flushing. Items added while paused are still buffered
   * (up to maxBufferSize) but never sent until start() is called.
   */
  pause(): void {
    this._paused = true;
    this._clearTimer();
  }

  /**
   * Resume automatic flushing. Arms the flush timer immediately if the
   * buffer is non-empty.
   */
  start(): void {
    if (!this._paused) return;
    this._paused = false;
    if (this._buffer.length > 0) {
      this._armTimer();
    }
  }

  /**
   * Synchronously drain and return all buffered items, clearing the buffer.
   * Intended for use during page unload (sendBeacon path).
   */
  drain(): T[] {
    this._clearTimer();
    const items = this._buffer.slice();
    this._buffer = [];
    this._bufferBytes = 0;
    return items;
  }

  get size(): number { return this._buffer.length; }
}
