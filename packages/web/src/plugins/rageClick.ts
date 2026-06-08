import type { WinceClient } from '../client';
import { sanitizeClick } from './_click-utils';

export interface RageClickOptions {
  /** Number of clicks within `windowMs` that triggers a rage-click. Default: 3. */
  threshold?: number;
  /** Time window (ms) for counting rapid clicks on the same element. Default: 300. */
  windowMs?: number;
  /** How long (ms) to keep an entry before resetting its click count. Default: 500. */
  idleMs?: number;
}

interface ClickRecord {
  count:   number;
  firstAt: number;
  timer:   ReturnType<typeof setTimeout>;
}

/**
 * Rage-click detection plugin.
 *
 * Emits `$rage_click` when the same element is clicked `threshold` or more
 * times within `windowMs` milliseconds. Uses the same element whitelist and
 * PII exclusions as `mountClick` via the shared `sanitizeClick()` utility.
 *
 * @returns A cleanup function that removes the event listener.
 */
export function mountRageClick(tracker: WinceClient, options?: RageClickOptions): () => void {
  if (typeof document === 'undefined') return () => undefined;

  const threshold = options?.threshold ?? 3;
  const windowMs  = options?.windowMs  ?? 300;
  const idleMs    = options?.idleMs    ?? 500;

  const records  = new WeakMap<Element, ClickRecord>();
  const timers   = new Set<ReturnType<typeof setTimeout>>();

  function armTimer(el: Element, ms: number): ReturnType<typeof setTimeout> {
    const t = setTimeout(() => {
      records.delete(el);
      timers.delete(t);
    }, ms);
    timers.add(t);
    return t;
  }

  const handler = (e: MouseEvent) => {
    const data = sanitizeClick(e);
    if (!data) return;

    const el  = data.target as Element;
    const now = Date.now();
    const rec = records.get(el);

    if (rec && now - rec.firstAt <= windowMs) {
      rec.count++;
      clearTimeout(rec.timer);
      timers.delete(rec.timer);
      rec.timer = armTimer(el, idleMs);

      if (rec.count >= threshold) {
        clearTimeout(rec.timer);
        timers.delete(rec.timer);
        records.delete(el);
        tracker.track('$rage_click', {
          tag:      data.tag,
          text:     data.text,
          href:     data.href,
          track_id: data.trackId,
          count:    rec.count,
          first_at: rec.firstAt,
          ...data.attrs,
        });
      }
    } else {
      if (rec) {
        clearTimeout(rec.timer);
        timers.delete(rec.timer);
      }
      records.set(el, {
        count:   1,
        firstAt: now,
        timer:   armTimer(el, idleMs),
      });
    }
  };

  document.addEventListener('click', handler, { capture: true });

  return () => {
    document.removeEventListener('click', handler, { capture: true });
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
}
