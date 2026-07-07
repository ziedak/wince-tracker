import type { WinceClient } from '../client';
import { ErrorCaptureType, pluginSource } from './types';

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

  const captureWindowErrors = options.captureWindowErrors ?? true;
  const captureUnhandledRejections = options.captureUnhandledRejections ?? true;
  const maxStackLength = options.maxStackLength ?? 1024;
  const ignore = options.ignore ?? [];

  // Dedup: same error message + line number → only captured once per session.
  // Plain Map + FIFO eviction is sufficient for a max-20 set; the LRU linked-list
  // overhead from @wince/cache is wasted here.
  const _dedupKeys = new Map<string, true>();

  function deduped(key: string): boolean {
    if (_dedupKeys.has(key)) return true;
    if (_dedupKeys.size >= 20) {
      // FIFO eviction — delete the oldest entry (Map iterator returns in insertion order).
      const oldestKey = _dedupKeys.keys().next().value;
      if (oldestKey) _dedupKeys.delete(oldestKey);
    }
    _dedupKeys.set(key, true);
    return false;
  }

  function shouldIgnore(message: string): boolean {
    return ignore.some((re) => re.test(message));
  }

  function trimStack(stack: string | undefined): string | undefined {
    if (!stack) return undefined;
    return stack.length > maxStackLength
      ? stack.slice(0, maxStackLength)
      : stack;
  }

  const cleanups: Array<() => void> = [];

  if (captureWindowErrors) {
    const handler = (event: ErrorEvent) => {
      const message = event.message || 'Unknown error';
      if (shouldIgnore(message)) return;

      const key = `${message}:${event.lineno ?? 0}`;
      if (deduped(key)) return;

      tracker.track<ErrorCaptureType>('$error', {
        type: 'uncaught',
        message,
        source: event.filename || undefined,
        lineno: event.lineno || undefined,
        colno: event.colno || undefined,
        stack: trimStack((event.error as Error | undefined)?.stack),
        $plugin_source: pluginSource.ErrorCapture,
      });
    };

    window.addEventListener('error', handler);
    cleanups.push(() => window.removeEventListener('error', handler));
  }

  if (captureUnhandledRejections) {
    const handler = (event: PromiseRejectionEvent) => {
      const reason = event.reason as unknown;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : 'Unhandled promise rejection';

      if (shouldIgnore(message)) return;

      const key = `rejection:${message}`;
      if (deduped(key)) return;

      tracker.track<ErrorCaptureType>('$error', {
        type: 'unhandled_rejection',
        message,
        stack: trimStack(reason instanceof Error ? reason.stack : undefined),
        $plugin_source: pluginSource.ErrorCapture,
      });
    };

    window.addEventListener('unhandledrejection', handler);
    cleanups.push(() =>
      window.removeEventListener('unhandledrejection', handler),
    );
  }

  return () => {
    for (const fn of cleanups) fn();
  };
}
