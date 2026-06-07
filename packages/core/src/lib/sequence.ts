// ============================================================================
// SequenceCounter — per-session monotonic counter
// ============================================================================

/**
 * Issues a monotonically increasing integer sequence starting at 0.
 * One instance per session; call `reset()` when a new session starts to
 * restart the counter.
 *
 * The sequence number (`seq`) is included in every `TrackEvent` so the
 * backend can detect gaps (dropped events) or duplicates (retried events).
 */
export class SequenceCounter {
  private _seq = 0;

  /** Return the next sequence number and advance the counter. */
  next(): number { return this._seq++; }

  /** Reset the counter back to 0 (call when a new session starts). */
  reset(): void { this._seq = 0; }

  /** Current counter value without advancing it. */
  get current(): number { return this._seq; }
}
