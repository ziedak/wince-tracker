import { LRUCache } from '@wince/cache';
import type { WinceClient } from '../client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ErrorCaptureOptions {
  /**
   * Capture `window.onerror` / `window.addEventListener('error', ...)` events.
   * Default: `true`
   */
  captureWindowErrors?: boolean;
  /**
   * Capture `window.addEventListener('unhandledrejection', ...)` events.
   * Default: `true`
   */
  captureUnhandledRejections?: boolean;
  /**
   * Maximum stack trace length in characters. Longer stacks are truncated.
   * Default: `1024`
   */
  maxStackLength?: number;
  /**
   * Errors whose `message` matches any of these patterns are silently dropped.
   *
   * @example
   * ```ts
   * ignore: [/ResizeObserver loop/, /Non-Error promise rejection/]
   * ```
   */
  ignore?: RegExp[];
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Unhandled error & promise rejection capture plugin.
 *
 * Fires `$error` events so that JS crashes during checkout are correlated
 * with the cart-abandon funnel. The same error firing repeatedly is
 * deduplicated within the session (LRU cache, max 20 entries).
 *
 * Only the error message, source location, and stack trace are captured —
 * never local variable state or user input values.
 *
 * @returns A cleanup function that removes all listeners.
 *
 * @example
 * ```ts
 * const cleanup = mountErrorCapture(tracker);
 * // With options:
 * const cleanup = mountErrorCapture(tracker, {
 *   ignore: [/ResizeObserver loop/],
 *   maxStackLength: 512,
 * });
 * ```
 */
export function mountErrorCapture(
  tracker: WinceClient,
  options: ErrorCaptureOptions = {},
): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const captureWindowErrors        = options.captureWindowErrors        ?? true;
  const captureUnhandledRejections = options.captureUnhandledRejections ?? true;
  const maxStackLength             = options.maxStackLength             ?? 1024;
  const ignore                     = options.ignore                     ?? [];

  // Dedup: same error message + line number → only captured once per session.
  const seen = new LRUCache<string, true>({ maxSize: 20 });

  function shouldIgnore(message: string): boolean {
    return ignore.some((re) => re.test(message));
  }

  function deduped(key: string): boolean {
    if (seen.get(key)) return true;
    seen.set(key, true);
    return false;
  }

  function trimStack(stack: string | undefined): string | undefined {
    if (!stack) return undefined;
    return stack.length > maxStackLength ? stack.slice(0, maxStackLength) : stack;
  }

  const cleanups: Array<() => void> = [];

  if (captureWindowErrors) {
    const handler = (event: ErrorEvent) => {
      const message = event.message || 'Unknown error';
      if (shouldIgnore(message)) return;

      const key = `${message}:${event.lineno ?? 0}`;
      if (deduped(key)) return;

      tracker.track('$error', {
        type:    'uncaught',
        message,
        source:  event.filename  || undefined,
        lineno:  event.lineno    || undefined,
        colno:   event.colno     || undefined,
        stack:   trimStack((event.error as Error | undefined)?.stack),
      });
    };

    window.addEventListener('error', handler);
    cleanups.push(() => window.removeEventListener('error', handler));
  }

  if (captureUnhandledRejections) {
    const handler = (event: PromiseRejectionEvent) => {
      const reason  = event.reason as unknown;
      const message = reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Unhandled promise rejection';

      if (shouldIgnore(message)) return;

      const key = `rejection:${message}`;
      if (deduped(key)) return;

      tracker.track('$error', {
        type:    'unhandled_rejection',
        message,
        stack:   trimStack(reason instanceof Error ? reason.stack : undefined),
      });
    };

    window.addEventListener('unhandledrejection', handler);
    cleanups.push(() => window.removeEventListener('unhandledrejection', handler));
  }

  return () => {
    for (const fn of cleanups) fn();
  };
}
