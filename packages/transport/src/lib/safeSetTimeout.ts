/**
 * A `setTimeout` wrapper that calls `.unref()` on the returned handle when available.
 * In Node.js, an unref'd timer does not keep the event loop alive — the process can exit
 * naturally without waiting for the timer to fire.
 * In browsers and other runtimes that don't have `.unref()`, this is a no-op wrapper.
 */
export function safeSetTimeout(
  fn: () => void,
  ms: number,
): ReturnType<typeof setTimeout> {
  const t = setTimeout(fn, ms);
  (t as unknown as { unref?(): void }).unref?.();
  return t;
}
