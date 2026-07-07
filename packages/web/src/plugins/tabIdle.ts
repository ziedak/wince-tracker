import type { WinceClient } from '../client';
import { pluginSource, TabIdleType } from './types';

export interface TabIdleOptions {
  /** Milliseconds of inactivity before firing `$user_idle`. Default: 30 000 (30 s). */
  idleMs?: number;
}

const ACTIVITY_EVENTS = [
  'mousemove',
  'keydown',
  'scroll',
  'click',
  'touchstart',
] as const;

/**
 * Tab-local idle detection plugin.
 *
 * Fires `$user_idle` after `idleMs` milliseconds with no mouse, keyboard,
 * scroll, click, or touch activity in THIS tab — regardless of whether the
 * user is active in other tabs.
 *
 * This is intentionally separate from the global `SessionManager` idle timeout
 * (which governs session rotation). Use this to detect per-tab inactivity —
 * e.g. to auto-trigger `$cart_checkout_abandon` when a user goes idle on the
 * checkout page, even while they are browsing another tab.
 *
 * The timer is reset on every qualifying activity event and fires at most once
 * per idle period (it re-arms automatically after firing so a user who returns
 * to the tab will eventually trigger another idle event if they go idle again).
 *
 * @returns A cleanup function that removes all listeners and cancels the timer.
 *
 * @example
 * ```ts
 * const cleanup = mountTabIdle(tracker, { idleMs: 30_000 });
 * ```
 */
export function mountTabIdle(
  tracker: WinceClient,
  options?: TabIdleOptions,
): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const idleMs = options?.idleMs ?? 30_000;
  let _timer: ReturnType<typeof setTimeout> | undefined;
  let _idleStartAt = Date.now();

  function arm(): void {
    if (_timer !== undefined) clearTimeout(_timer);
    _idleStartAt = Date.now();
    _timer = setTimeout(() => {
      _timer = undefined;
      tracker.track<TabIdleType>('$user_idle', {
        idle_ms: Date.now() - _idleStartAt,
        $plugin_source: pluginSource.TabIdle,
      });
      // Re-arm so subsequent idle periods are also detected.
      arm();
    }, idleMs);
  }

  for (const evt of ACTIVITY_EVENTS) {
    window.addEventListener(evt, arm, { passive: true, capture: true });
  }

  arm(); // start the countdown immediately on mount

  return () => {
    if (_timer !== undefined) {
      clearTimeout(_timer);
      _timer = undefined;
    }
    for (const evt of ACTIVITY_EVENTS) {
      window.removeEventListener(evt, arm, { capture: true });
    }
  };
}
