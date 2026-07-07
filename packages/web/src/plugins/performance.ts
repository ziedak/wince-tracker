import type { WinceClient } from '../client';
import { PerformanceType, pluginSource } from './types';

export interface PerformanceOptions {
  /**
   * Observe Largest Contentful Paint (LCP). Default: true.
   * LCP measures when the largest visible content element is painted.
   */
  trackLCP?: boolean;
  /**
   * Observe Cumulative Layout Shift (CLS). Default: true.
   * CLS measures unexpected visual instability during page load.
   */
  trackCLS?: boolean;
  /**
   * Observe Interaction to Next Paint (INP). Default: true.
   * INP measures responsiveness to user interactions.
   */
  trackINP?: boolean;
  /**
   * Observe First Contentful Paint (FCP) and Time to First Byte (TTFB)
   * from Navigation Timing. Default: true.
   */
  trackNavigationTiming?: boolean;
}

/**
 * Core Web Vitals plugin.
 *
 * Fires a single `$performance` event per page load with LCP, CLS, INP, FCP,
 * and TTFB metrics — the signals Google uses for Search ranking and which
 * strongly correlate with cart abandonment and conversion rate.
 *
 * Uses `PerformanceObserver` (Chrome 52+, Firefox 57+, Safari 15+). No-ops
 * gracefully in environments without the API.
 *
 * The event fires on `visibilitychange` (hidden) or `pagehide` — whichever
 * comes first — so the final accumulated values are captured before the page
 * is unloaded.
 *
 * @returns A cleanup function that disconnects all observers.
 *
 * @example
 * ```ts
 * const cleanup = mountPerformance(tracker);
 * ```
 */
export function mountPerformance(
  tracker: WinceClient,
  options?: PerformanceOptions,
): () => void {
  if (
    typeof window === 'undefined' ||
    typeof PerformanceObserver === 'undefined'
  ) {
    return () => undefined;
  }

  const trackLCP = options?.trackLCP ?? true;
  const trackCLS = options?.trackCLS ?? true;
  const trackINP = options?.trackINP ?? true;
  const trackNavigationTiming = options?.trackNavigationTiming ?? true;

  let _lcp: number | undefined;
  let _cls = 0;
  let _inp: number | undefined;

  const observers: PerformanceObserver[] = [];

  function tryObserve(
    type: string,
    cb: PerformanceObserverCallback,
    init?: Record<string, unknown>,
  ): void {
    try {
      if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return;
      const obs = new PerformanceObserver(cb);
      // Cast to bypass TS DOM lib gaps (e.g. durationThreshold not yet typed).
      obs.observe({ type, buffered: true, ...init } as PerformanceObserverInit);
      observers.push(obs);
    } catch {
      // Unsupported entry type in this browser — skip silently.
    }
  }

  if (trackLCP) {
    tryObserve('largest-contentful-paint', (list) => {
      // The last entry is the most up-to-date LCP candidate.
      const entries = list.getEntries();
      if (entries.length > 0) {
        _lcp = Math.round(
          (entries[entries.length - 1] as PerformancePaintTiming).startTime,
        );
      }
    });
  }

  if (trackCLS) {
    tryObserve('layout-shift', (list) => {
      for (const entry of list.getEntries()) {
        // Only count unexpected shifts (no recent user input within 500ms).
        const ls = entry as PerformanceEntry & {
          hadRecentInput?: boolean;
          value?: number;
        };
        if (!ls.hadRecentInput) {
          _cls += ls.value ?? 0;
        }
      }
    });
  }

  if (trackINP) {
    // durationThreshold: 0 is required to capture all interactions (default 104ms
    // would silently miss fast interactions that still degrade perceived responsiveness).
    // interactionId > 0 filters to genuine user interactions (click, key, tap) —
    // excluding programmatic dispatchEvent calls and scroll events which have no
    // interactionId and should not count toward INP.
    tryObserve(
      'event',
      (list) => {
        for (const entry of list.getEntries()) {
          // Cast to include interactionId (not yet typed in all TS DOM lib versions).
          const e = entry as PerformanceEventTiming & {
            interactionId?: number;
          };
          if (!e.interactionId) continue; // not a user interaction — skip
          const d = Math.round(e.duration);
          if (_inp === undefined || d > _inp) _inp = d;
        }
      },
      { durationThreshold: 0 },
    );
  }

  let _fired = false;

  function flush(): void {
    if (_fired) return;
    _fired = true;

    const props: Omit<PerformanceType, '$plugin_source'> = {};

    if (trackLCP) props['lcp_ms'] = _lcp;

    if (trackCLS) {
      // CLS is a dimensionless score — round to 4 decimal places.
      props['cls_score'] = Math.round(_cls * 10_000) / 10_000;
    }

    if (trackINP) props['inp_ms'] = _inp;

    if (trackNavigationTiming && typeof performance !== 'undefined') {
      try {
        const nav = performance.getEntriesByType('navigation')[0] as
          | PerformanceNavigationTiming
          | undefined;
        if (nav) {
          const fcpEntry = performance.getEntriesByName(
            'first-contentful-paint',
          )[0] as PerformancePaintTiming | undefined;
          if (fcpEntry) props['fcp_ms'] = Math.round(fcpEntry.startTime);
          // TTFB = responseStart relative to navigationStart (which is 0 for navigation entries).
          props['ttfb_ms'] = Math.round(nav.responseStart);
          props['dom_content_loaded_ms'] = Math.round(
            nav.domContentLoadedEventEnd,
          );
          props['load_ms'] = Math.round(nav.loadEventEnd);
        }
      } catch {
        // Performance API unavailable or cross-origin restriction.
      }
    }

    tracker.track<PerformanceType>('$performance', {
      ...props,
      $plugin_source: pluginSource.Performance,
    });
  }

  // Fire on page hide / visibility hidden — first one wins (_fired guard).
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  const onPageHide = () => flush();

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);

  return () => {
    for (const obs of observers) obs.disconnect();
    observers.length = 0;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
  };
}
