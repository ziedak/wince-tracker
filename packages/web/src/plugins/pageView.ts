import type { WinceClient } from '../client';

export interface PageViewOptions {
  /** Track scroll depth on each page. Default: true. */
  trackScrollDepth?: boolean;
  /** Track time the page was in the foreground. Default: true. */
  trackVisibility?: boolean;
  /** Track total time between page() calls. Default: true. */
  trackTimeOnPage?: boolean;
}

function _scrollState() {
  const el = document.documentElement;
  if (!el) return { y: 0, max: 0, contentH: 0, viewportH: 0, pct: 0 };
  const y        = el.scrollTop;
  const contentH = el.scrollHeight;
  const viewportH = el.clientHeight;
  const scrollable = contentH - viewportH;
  const pct = scrollable <= 0 ? 100 : Math.ceil((y / scrollable) * 100);
  return { y, max: scrollable, contentH, viewportH, pct };
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
  let _maxScrollPct     = 0;
  let _lastScrollPct    = 0;
  let _maxScrollY       = 0;
  let _lastScrollY      = 0;
  let _contentH         = 0;  // snapshot of scrollHeight for output
  let _maxVelocity      = 0;  // px/ms — max speed observed in any frame
  let _directionChanges = 0;
  let _lastDirection    = 0;  // -1=up, 0=stationary, 1=down
  let _prevScrollY      = 0;  // previous frame's Y for velocity calc
  let _rafPending       = false;
  let _lastRafTs        = 0;  // timestamp of the previous RAF frame

  // ---------- resize state ----------
  let _resizeCount   = 0;
  let _rafResize     = false;
  let _lastWidth     = window.innerWidth;
  let _lastHeight    = window.innerHeight;

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

  function buildMetrics(prefix = '$prev_'): Record<string, number> {
    const props: Record<string, number> = {};
    if (trackScrollDepth) {
      props[`${prefix}scroll_depth_pct`]        = _lastScrollPct;
      props[`${prefix}max_scroll_depth_pct`]    = _maxScrollPct;
      props[`${prefix}scroll_px`]               = _lastScrollY;
      props[`${prefix}max_scroll_px`]           = _maxScrollY;
      props[`${prefix}content_height_px`]       = _contentH;
      props[`${prefix}scroll_direction_changes`] = _directionChanges;
      props[`${prefix}scroll_max_velocity`]     = Math.round(_maxVelocity * 1000); // px/s
      props[`${prefix}resize_count`]            = _resizeCount;
      props[`${prefix}viewport_width_px`]       = _lastWidth;
      props[`${prefix}viewport_height_px`]      = _lastHeight;
    }
    if (trackVisibility) {
      snapshotVisibility();
      props[`${prefix}visible_time_ms`] = _visibleMs;
    }
    if (trackTimeOnPage) {
      props[`${prefix}time_on_page_ms`] = Date.now() - _pageStartAt;
    }
    return props;
  }

  function resetMetrics(): void {
    _maxScrollPct     = 0;
    _lastScrollPct    = 0;
    _maxScrollY       = 0;
    _lastScrollY      = 0;
    _contentH         = 0;
    _maxVelocity      = 0;
    _directionChanges = 0;
    _lastDirection    = 0;
    _prevScrollY      = 0;
    _lastRafTs        = 0;
    _resizeCount      = 0;
    _lastWidth        = window.innerWidth;
    _lastHeight       = window.innerHeight;
    if (trackVisibility) {
      _visibleMs    = 0;
      _visibleStart = document.visibilityState === 'visible' ? Date.now() : 0;
    }
    _pageStartAt = Date.now();
  }

  // ---------- prerender guard ----------
  // Don't fire $page_view until the page is actually visible. Browsers (Chrome,
  // Next.js prefetch, WordPress prerender) may render the page in a hidden state
  // before the user navigates to it. Firing page() on a hidden page produces
  // phantom pageviews that inflate funnel metrics.
  let _pendingFirstPage = document.visibilityState !== 'visible';

  if (!_pendingFirstPage) {
    tracker.page();
    resetMetrics();
  }

  // SPA navigation — fire page() with accumulated metrics, then reset.
  const onNavigate = () => {
    tracker.page(buildMetrics());
    resetMetrics();
  };

  // ---------- scroll & resize listeners ----------
  let scrollHandler: (() => void) | undefined;
  let scrollEndHandler: (() => void) | undefined;
  let resizeHandler: (() => void) | undefined;

  if (trackScrollDepth) {
    function onRaf(ts: number): void {
      _rafPending = false;
      const s   = _scrollState();
      const now = ts || Date.now();

      // ----- velocity: px/ms since last frame -----
      if (_lastRafTs > 0 && now > _lastRafTs) {
        const dt = now - _lastRafTs;
        const v  = Math.abs(s.y - _prevScrollY) / dt;
        if (v > _maxVelocity) _maxVelocity = v;
      }
      _lastRafTs   = now;
      _prevScrollY = s.y;

      // ----- direction change (pixel-level, not percentage) -----
      const delta = s.y - _lastScrollY;
      if (delta > 2) {
        // scrolling down
        if (_lastDirection < 0) _directionChanges++;
        _lastDirection = 1;
      } else if (delta < -2) {
        // scrolling up
        if (_lastDirection > 0) _directionChanges++;
        _lastDirection = -1;
      }
      // |delta| ≤ 2 → stationary bounce → don't count as direction change

      _lastScrollY   = s.y;
      _lastScrollPct = s.pct;
      _contentH      = s.contentH;
      if (s.pct > _maxScrollPct) _maxScrollPct = s.pct;
      if (s.y   > _maxScrollY)   _maxScrollY   = s.y;
    }

    scrollHandler = () => {
      if (_rafPending) return;
      _rafPending = true;
      requestAnimationFrame(onRaf);
    };

    // scrollend fires once when scrolling truly stops — captures the deliberate
    // reading position vs. fleeting momentum passes. We just snapshot via the
    // same RAF path to update last-position state.
    scrollEndHandler = () => {
      if (_rafPending) return;
      _rafPending = true;
      requestAnimationFrame(onRaf);
    };

    // Resize: recalculate percentage-based max from pixel max (the ground truth)
    // because the denominator (scrollHeight) changed. Also track resize count
    // as an engagement signal.
    resizeHandler = () => {
      if (_rafResize) return;
      _rafResize = true;
      requestAnimationFrame(() => {
        _rafResize = false;
        _resizeCount++;
        _lastWidth  = window.innerWidth;
        _lastHeight = window.innerHeight;
        // Recompute pct from pixel ground truth.
        const s = _scrollState();
        if (s.max > 0) {
          _maxScrollPct  = Math.ceil((_maxScrollY / s.max) * 100);
          _lastScrollPct = s.pct;
          _lastScrollY   = s.y;
        }
      });
    };

    window.addEventListener('scroll',   scrollHandler,     { passive: true });
    window.addEventListener('scrollend', scrollEndHandler,  { passive: true });
    window.addEventListener('resize',    resizeHandler,     { passive: true });
  }

  // ---------- visibility listener ----------
  // Handles both the prerender deferral (first visible) and ongoing
  // visible/hidden transitions for accurate visibility time tracking.
  let visibilityHandler: (() => void) | undefined;
  if (trackVisibility) {
    visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        if (_pendingFirstPage) {
          // Page was prerendered — fire the deferred first page view now.
          _pendingFirstPage = false;
          tracker.page();
          resetMetrics(); // starts fresh timers from this moment
          return;
        }
        _visibleStart = Date.now();
      } else {
        if (_visibleStart > 0) {
          _visibleMs   += Date.now() - _visibleStart;
          _visibleStart = 0;
        }
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  } else if (_pendingFirstPage) {
    // trackVisibility is off but we still need the prerender guard.
    const onceVisible = () => {
      if (document.visibilityState !== 'visible') return;
      _pendingFirstPage = false;
      document.removeEventListener('visibilitychange', onceVisible);
      tracker.page();
      resetMetrics();
    };
    document.addEventListener('visibilitychange', onceVisible);
  }

  // ---------- $page_leave before transport drain ----------
  // Registered as a before-drain hook so it fires before sendBeacon drains
  // the transport buffer on pagehide — ensuring the event is included in the
  // beacon payload for the last page (hard navigation, tab close).
  const removeBeforeDrainHook = tracker.addBeforeDrainHook(() => {
    if (_pendingFirstPage) return; // page was never made visible — no $page_view to pair with
    if (trackVisibility) snapshotVisibility();
    tracker.track('$page_leave', buildMetrics('')); // no $prev_ prefix — metrics belong to this page
  });

  window.addEventListener('popstate',   onNavigate);
  window.addEventListener('hashchange', onNavigate);

  return () => {
    removeBeforeDrainHook();
    window.removeEventListener('popstate',   onNavigate);
    window.removeEventListener('hashchange', onNavigate);
    if (scrollHandler)     window.removeEventListener('scroll',     scrollHandler);
    if (scrollEndHandler)  window.removeEventListener('scrollend',  scrollEndHandler);
    if (resizeHandler)     window.removeEventListener('resize',     resizeHandler);
    if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
  };
}
