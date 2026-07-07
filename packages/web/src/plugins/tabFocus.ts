import type { WinceClient } from '../client';
import { pluginSource, TabFocusType } from './types';

export interface TabFocusOptions {
  /**
   * Time window in ms to accumulate blur/focus transitions before emitting
   * a rollup event. Set to 0 to emit individual events on every transition
   * (legacy behaviour). Default: 60_000 (1 minute).
   */
  rollupIntervalMs?: number;
}

/**
 * Tab blur/focus plugin.
 *
 * Aggregates visibility changes over a rolling time window and emits a single
 * `$tab_focus_rollup` event at the end of each window (or on `pagehide`),
 * reporting how many times the user switched away, total time away, and
 * total time focused — rather than spamming one event per transition.
 *
 * For high-tabbers (users opening 10+ tabs) this prevents runaway event
 * volume while preserving the signal the AI model needs.
 *
 * Set `rollupIntervalMs: 0` to revert to the original per-transition events
 * (`$tab_blur` / `$tab_focus`) for debugging or low-traffic use.
 *
 * @returns A cleanup function that removes all event listeners.
 */
export function mountTabFocus(
  tracker: WinceClient,
  options?: TabFocusOptions,
): () => void {
  if (typeof document === 'undefined') return () => undefined;

  const rollupMs = options?.rollupIntervalMs ?? 60_000;

  // ── Legacy per-transition mode ─────────────────────────────────────────────
  if (rollupMs === 0) {
    let blurredAt: number | undefined;
    let isBlurred = false;
    const handler = () => {
      if (document.hidden) {
        if (isBlurred) return;
        isBlurred = true;
        blurredAt = Date.now();
        tracker.track<TabFocusType>('$tab_blur', {
          $plugin_source: pluginSource.TabFocus,
          blurred_at: blurredAt,
        });
        return;
      }

      if (!isBlurred) return;

      const awayDurationMs = blurredAt !== undefined ? Date.now() - blurredAt : undefined;
      const blurredAtSnapshot = blurredAt;
      blurredAt = undefined;
      isBlurred = false;
      tracker.track<TabFocusType>('$tab_focus', {
        $plugin_source: pluginSource.TabFocus,
        blurred_at: blurredAtSnapshot,
        away_duration_ms: awayDurationMs,
      });
    };

    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }

  // ── Rollup mode ────────────────────────────────────────────────────────────
  // Accumulators for the current window.
  let _blurCount = 0;
  let _awayMs = 0;
  let _focusedMs = 0;
  let _windowStart = Date.now();
  let _lastChangeAt = _windowStart;
  let _isHidden = document.hidden;
  let _rollupTimer: ReturnType<typeof setInterval> | undefined;

  function flush(reason: 'interval' | 'pagehide'): void {
    // Snapshot any in-progress blur/focus period before emitting.
    const now = Date.now();
    if (_isHidden) {
      _awayMs += now - _lastChangeAt;
    } else {
      _focusedMs += now - _lastChangeAt;
    }

    if (_blurCount === 0 && reason === 'interval') {
      // Nothing happened this window — skip the event entirely.
      _windowStart = now;
      _lastChangeAt = now;
      _focusedMs = 0;
      return;
    }

    tracker.track<TabFocusType>('$tab_focus_rollup', {
      blur_count: _blurCount,
      away_ms: _awayMs,
      focused_ms: _focusedMs,
      window_ms: now - _windowStart,
      reason,
      $plugin_source: pluginSource.TabFocus,
    });

    // Reset accumulators for the next window.
    _blurCount = 0;
    _awayMs = 0;
    _focusedMs = 0;
    _windowStart = now;
    _lastChangeAt = now;
  }

  const onVisibilityChange = () => {
    const now = Date.now();
    if (document.hidden) {
      // Transitioned to hidden — record focused time up to now.
      if (_isHidden) return;
      _focusedMs += now - _lastChangeAt;
      _blurCount++;
      _isHidden = true;
      _lastChangeAt = now;
    } else {
      // Transitioned to visible — tally away time.
      if (!_isHidden) return;
      _awayMs += now - _lastChangeAt;
      _isHidden = false;
      _lastChangeAt = now;
    }
  };

  const onPageHide = () => {
    flush('pagehide');
    if (_rollupTimer !== undefined) {
      clearInterval(_rollupTimer);
      _rollupTimer = undefined;
    }
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  _rollupTimer = setInterval(() => flush('interval'), rollupMs);

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    if (_rollupTimer !== undefined) {
      clearInterval(_rollupTimer);
      _rollupTimer = undefined;
    }
  };
}
