/**
 * Token-bucket rate limiter.
 *
 * Tokens refill at `refillRate` tokens per `refillIntervalMs`.
 * Burst capacity is `bucketSize` tokens.
 * This is smoother than a tumbling window: it allows short bursts up to
 * `bucketSize` but then throttles to the configured steady-state rate.
 */
export interface TokenBucketOptions {
  /** Maximum tokens in the bucket (burst capacity). */
  bucketSize: number;
  /** Number of tokens added per refill interval. */
  refillRate: number;
  /** How often (ms) tokens are refilled. */
  refillIntervalMs: number;
}

export class TokenBucketRateLimiter {
  private readonly _bucketSize:      number;
  private readonly _refillRate:      number;
  private readonly _refillIntervalMs: number;

  private _tokens:    number;
  private _lastRefill: number;

  constructor(opts: TokenBucketOptions) {
    this._bucketSize       = Math.max(1, opts.bucketSize);
    this._refillRate       = Math.max(1, opts.refillRate);
    this._refillIntervalMs = Math.max(1, opts.refillIntervalMs);
    this._tokens           = this._bucketSize;
    this._lastRefill       = Date.now();
  }

  /**
   * Attempt to consume one token.
   * Returns `true` if the request is allowed, `false` if rate-limited.
   */
  consume(): boolean {
    this._refill();
    if (this._tokens <= 0) return false;
    this._tokens--;
    return true;
  }

  private _refill(): void {
    const now     = Date.now();
    const elapsed = now - this._lastRefill;
    if (elapsed < 0) {
      // Clock went backward (NTP correction) — reset window
      this._lastRefill = now;
      return;
    }
    const intervals = Math.floor(elapsed / this._refillIntervalMs);
    if (intervals > 0) {
      this._tokens = Math.min(
        this._bucketSize,
        this._tokens + intervals * this._refillRate,
      );
      this._lastRefill += intervals * this._refillIntervalMs;
    }
  }

  /** Reset the bucket to full. */
  reset(): void {
    this._tokens    = this._bucketSize;
    this._lastRefill = Date.now();
  }
}
