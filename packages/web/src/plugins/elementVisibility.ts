import type { WinceClient } from '../client';

export interface ElementVisibilityOptions {
  /**
   * CSS selector for elements to observe. Only elements matching this selector
   * are tracked — avoids observing every DOM node.
   * Default: `'[data-track-visible]'`
   */
  selector?: string;
  /**
   * Intersection ratio threshold at which an element is considered "visible".
   * Default: `0.5`
   */
  threshold?: number;
  /**
   * Minimum milliseconds an element must be visible before emitting an event.
   * Filters out fleeting scroll-past exposures.
   * Default: `1000`
   */
  minVisibleMs?: number;
  /**
   * When true, unobserve an element after its first `$element_visible` emission.
   * Prevents repeated fires on scroll-heavy pages.
   * Default: `true`
   */
  once?: boolean;
}

interface VisEntry {
  enteredAt: number;
  maxRatio:  number;
}

/**
 * Element visibility plugin.
 *
 * Tracks how long specific elements were in the viewport using IntersectionObserver.
 * Opt-in via the `[data-track-visible]` attribute (or a custom `selector`).
 *
 * Emits `$element_visible` when an element's visibility drops below `threshold`
 * (or leaves the viewport entirely) after having been above the threshold for at
 * least `minVisibleMs` continuously. Flushes any still-visible elements on cleanup.
 *
 * Tracks "above-threshold continuous exposure" — each uninterrupted period
 * where `intersectionRatio >= threshold` is treated as one exposure window.
 * This is the correct metric for the AI model to determine whether a user
 * saw an offer at meaningful quality before leaving.
 *
 * @returns A cleanup function that disconnects all observers.
 */
export function mountElementVisibility(
  tracker: WinceClient,
  options?: ElementVisibilityOptions,
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  if (typeof IntersectionObserver === 'undefined') return () => undefined;

  const selector     = options?.selector     ?? '[data-track-visible]';
  const threshold    = options?.threshold    ?? 0.5;
  const minVisibleMs = options?.minVisibleMs ?? 1000;
  const once         = options?.once         ?? true;

  const visible = new Map<Element, VisEntry>();

  function emitVisible(el: Element, visibleMs: number, maxRatio: number): void {
    const elementId = el.getAttribute('data-track-visible') || el.id || undefined;
    tracker.track('$element_visible', {
      element_id:        elementId,
      element_tag:       el.tagName.toLowerCase(),
      visible_ms:        Math.round(visibleMs),
      max_visible_ratio: Math.round(maxRatio * 100) / 100,
      $plugin_source:    'elementVisibility',
    });
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const el = entry.target;
        if (entry.isIntersecting && entry.intersectionRatio >= threshold) {
          // Element is above threshold — start a new exposure window or update maxRatio.
          // Reset enteredAt if the element re-enters after a below-threshold dip so we
          // track each above-threshold segment independently.
          const rec = visible.get(el);
          if (!rec) {
            visible.set(el, { enteredAt: Date.now(), maxRatio: entry.intersectionRatio });
          } else {
            if (entry.intersectionRatio > rec.maxRatio) rec.maxRatio = entry.intersectionRatio;
          }
        } else {
          // Element dropped below threshold OR left the viewport.
          // Either way the current above-threshold segment has ended.
          const rec = visible.get(el);
          if (rec) {
            visible.delete(el);
            const visibleMs = Date.now() - rec.enteredAt;
            if (visibleMs >= minVisibleMs) {
              emitVisible(el, visibleMs, rec.maxRatio);
              if (once) io.unobserve(el);
            }
          }
        }
      }
    },
    // Fire at 0 (element enters/leaves viewport) and at the threshold
    // (element crosses meaningful visibility). Dedup in case threshold === 0.
    { threshold: threshold === 0 ? [0] : [0, threshold] },
  );

  function observeMatches(): void {
    for (const el of Array.from(document.querySelectorAll(selector))) {
      io.observe(el);
    }
  }

  observeMatches();

  // Pick up elements added after mount (dynamic product cards, lazy sections, etc.).
  const mutObs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of Array.from(m.addedNodes)) {
        if (!(node instanceof Element)) continue;
        if (node.matches(selector)) io.observe(node);
        for (const child of Array.from(node.querySelectorAll(selector))) {
          io.observe(child);
        }
      }
    }
  });

  mutObs.observe(document.documentElement, { childList: true, subtree: true });

  return () => {
    // Flush currently-visible elements so partial exposures are not lost.
    const now = Date.now();
    for (const [el, rec] of visible) {
      const visibleMs = now - rec.enteredAt;
      if (visibleMs >= minVisibleMs) {
        emitVisible(el, visibleMs, rec.maxRatio);
      }
    }
    visible.clear();
    io.disconnect();
    mutObs.disconnect();
  };
}
