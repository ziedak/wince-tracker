import type { WinceClient } from '../client';

export interface PageViewOptions {
  /** Track scroll depth on each page. Default: true. */
  trackScrollDepth?: boolean;
  /** Track time the page was in the foreground. Default: true. */
  trackVisibility?: boolean;
  /** Track total time between page() calls. Default: true. */
  trackTimeOnPage?: boolean;
}

function scrollPct(): number {
  const el = document.documentElement;
  const scrollable = el.scrollHeight - el.clientHeight;
  if (scrollable <= 0) return 100;
  return Math.ceil((el.scrollTop / scrollable) * 100);
}

/**
 * Auto page-view plugin.
 *
 * - Fires `$page_view` immediately on mount (captures the initial page load).
 * - Fires `$page_view` on `popstate` and `hashchange` events (SPA navigation).
 * - Attaches previous-page scroll depth, visibility, and time-on-page metrics
 *   to each `$page_view` event so funnels can measure engagement.
 *
 * @returns A cleanup function that removes all event listeners.
 *
 * @example
 * ```ts
 * const cleanup = mountPageView(tracker, { trackScrollDepth: true });
 * ```
 */
export function mountPageView(tracker: WinceClient, options?: PageViewOptions): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const trackScrollDepth = options?.trackScrollDepth ?? true;
  const trackVisibility  = options?.trackVisibility  ?? true;
  const trackTimeOnPage  = options?.trackTimeOnPage  ?? true;

  // ---------- scroll state ----------
  let _maxScrollPct  = 0;
  let _lastScrollPct = 0;
  let _rafPending    = false;

  // ---------- visibility / time state ----------
  let _visibleMs    = 0;
  let _visibleStart = (trackVisibility && document.visibilityState === 'visible') ? Date.now() : 0;
  let _pageStartAt  = Date.now();

  function snapshotVisibility(): void {
    if (_visibleStart > 0) {
      _visibleMs   += Date.now() - _visibleStart;
      _visibleStart = document.visibilityState === 'visible' ? Date.now() : 0;
    }
  }

  function buildMetrics(): Record<string, number> {
    const props: Record<string, number> = {};
    if (trackScrollDepth) {
      props['$prev_scroll_depth_pct']     = _lastScrollPct;
      props['$prev_max_scroll_depth_pct'] = _maxScrollPct;
    }
    if (trackVisibility) {
      snapshotVisibility();
      props['$prev_visible_time_ms'] = _visibleMs;
    }
    if (trackTimeOnPage) {
      props['$prev_time_on_page_ms'] = Date.now() - _pageStartAt;
    }
    return props;
  }

  function resetMetrics(): void {
    _maxScrollPct  = 0;
    _lastScrollPct = 0;
    if (trackVisibility) {
      _visibleMs    = 0;
      _visibleStart = document.visibilityState === 'visible' ? Date.now() : 0;
    }
    _pageStartAt = Date.now();
  }

  // First page view has no prior-page metrics.
  tracker.page();
  resetMetrics();

  // SPA navigation — fire page() with accumulated metrics, then reset.
  const onNavigate = () => {
    tracker.page(buildMetrics());
    resetMetrics();
  };

  // ---------- scroll listener ----------
  let scrollHandler: (() => void) | undefined;
  if (trackScrollDepth) {
    scrollHandler = () => {
      if (_rafPending) return;
      _rafPending = true;
      requestAnimationFrame(() => {
        _rafPending    = false;
        const pct      = scrollPct();
        _lastScrollPct = pct;
        if (pct > _maxScrollPct) _maxScrollPct = pct;
      });
    };
    window.addEventListener('scroll', scrollHandler, { passive: true });
  }

  // ---------- visibility listener ----------
  let visibilityHandler: (() => void) | undefined;
  if (trackVisibility) {
    visibilityHandler = () => {
      if (document.visibilityState === 'hidden') {
        if (_visibleStart > 0) {
          _visibleMs   += Date.now() - _visibleStart;
          _visibleStart = 0;
        }
      } else {
        _visibleStart = Date.now();
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  }

  // pagehide: snapshot visibility accumulator before transport drain fires.
  const onPageHide = () => { if (trackVisibility) snapshotVisibility(); };
  window.addEventListener('pagehide', onPageHide);

  window.addEventListener('popstate',   onNavigate);
  window.addEventListener('hashchange', onNavigate);

  return () => {
    window.removeEventListener('popstate',   onNavigate);
    window.removeEventListener('hashchange', onNavigate);
    window.removeEventListener('pagehide',   onPageHide);
    if (scrollHandler)     window.removeEventListener('scroll',            scrollHandler);
    if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
  };
}
