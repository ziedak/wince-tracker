// ============================================================================
// Pipeline — synchronous middleware / enrichment chain
// ============================================================================

/**
 * A hook in the pipeline.
 * - Return the event (same or a new object) to pass it to the next hook.
 * - Return `null` or `undefined` to drop the event — subsequent hooks are
 *   skipped and `run()` returns `undefined`.
 */
export type PipelineHook<T> = (event: T) => T | null | undefined;

/**
 * Synchronous, ordered chain of hooks.
 *
 * Typical usage:
 * ```ts
 * const pipeline = new Pipeline<TrackEvent>()
 *   .use(enrichSession)   // adds sid, seq, anon, uid
 *   .use(samplingFilter)  // may drop the event
 *   .use(redactPii);      // scrubs sensitive props
 *
 * const enriched = pipeline.run(rawEvent);
 * if (enriched) transport.send(enriched);
 * ```
 */
export class Pipeline<T extends object> {
  private readonly _hooks: PipelineHook<T>[] = [];

  /**
   * Append a hook to the end of the chain. Returns `this` for method chaining.
   */
  use(hook: PipelineHook<T>): this {
    this._hooks.push(hook);
    return this;
  }

  /**
   * Run `event` through every registered hook in order.
   * Returns the (possibly modified) event, or `undefined` if any hook dropped it.
   */
  run(event: T): T | undefined {
    let current: T | null | undefined = event;
    for (const hook of this._hooks) {
      if (current == null) return undefined;
      current = hook(current);
    }
    return current ?? undefined;
  }

  /** Number of registered hooks. */
  get size(): number {
    return this._hooks.length;
  }
}
