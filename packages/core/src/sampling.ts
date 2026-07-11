// ============================================================================
// SamplingFilter
// ============================================================================

/**
 * FNV-1a 32-bit hash → value in [0, 1).
 * Used for deterministic sampling: the same seed always produces the same
 * result, so a given user either always sees an event or never does.
 */
function hashToFloat(str: string): number {
  let hash = 2_166_136_261; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16_777_619) >>> 0; // FNV prime, keep 32-bit unsigned
  }
  return hash / 0x1_0000_0000;
}

export interface SamplingOptions {
  /**
   * Fraction of events to keep: `0.0` = drop all, `1.0` = keep all.
   * Values outside [0, 1] throw a `RangeError`.
   */
  rate: number;
}

/**
 * Probabilistic event filter.
 *
 * - **Without a seed** — each call draws from `Math.random()` (per-event).
 * - **With a seed** — deterministic: the same seed always returns the same
 *   result. Pass the anonymous or user ID as the seed so a given user is
 *   either always sampled or never sampled (consistent UX).
 *
 * ```ts
 * const sampler = new SamplingFilter({ rate: 0.1 }); // 10 %
 * if (sampler.shouldTrack(identity.getAnonId())) {
 *   pipeline.run(event);
 * }
 * ```
 */
export class SamplingFilter {
  private readonly _rate: number;

  constructor(opts: SamplingOptions) {
    if (opts.rate < 0 || opts.rate > 1) {
      throw new RangeError(`SamplingFilter: rate must be between 0 and 1 (got ${opts.rate})`);
    }
    this._rate = opts.rate;
  }

  /**
   * Returns `true` if the event should be tracked.
   *
   * @param seed - Optional seed for deterministic sampling. Typically the
   *   anonymous or identified user ID.
   */
  shouldTrack(seed?: string): boolean {
    if (this._rate >= 1) return true;
    if (this._rate <= 0) return false;
    const score = seed !== undefined ? hashToFloat(seed) : Math.random();
    return score < this._rate;
  }

  get rate(): number {
    return this._rate;
  }
}
