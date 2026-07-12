import { EventPriority } from '@wince/types';
import type { WinceClient } from '../client';
import { useBroadCapture } from './_click-utils';
import { pluginSource, RageClickType } from './types';

export interface RageClickOptions {
  /** Number of clicks within `windowMs` that triggers a rage-click. Default: 3. */
  threshold?: number;
  /** Time window (ms) for counting rapid clicks on the same element. Default: 300. */
  windowMs?: number;
  /** How long (ms) to keep an entry before resetting its click count. Default: 500. */
  idleMs?: number;
}

interface ClickRecord {
  count: number;
  firstAt: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Rage-click detection plugin.
 *
 * Emits `$rage_click` when the same element is clicked `threshold` or more
 * times within `windowMs` milliseconds. Uses the broad click dispatcher so
 * ALL interactive-looking surfaces are covered — including non-semantic
 * containers styled with `cursor:pointer`, custom components identified by
 * ARIA role, and elements tracked via `[tabindex]` or `[onclick]`.
 *
 * @returns A cleanup function that removes the event listener.
 */
export function mountRageClick(tracker: WinceClient, options?: RageClickOptions): () => void {
  if (typeof document === 'undefined') return () => undefined;

  const threshold = options?.threshold ?? 3;
  const windowMs = options?.windowMs ?? 300;
  const idleMs = options?.idleMs ?? 500;

  const records = new WeakMap<Element, ClickRecord>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function armTimer(el: Element, ms: number): ReturnType<typeof setTimeout> {
    const t = setTimeout(() => {
      records.delete(el);
      timers.delete(t);
    }, ms);
    timers.add(t);
    return t;
  }

  const unsub = useBroadCapture((data) => {
    const el = data.target as Element;
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

        const props: RageClickType = {
          tag: data.tag,
          text: data.text,
          elements_chain: data.elements_chain,
          count: rec.count,
          first_at: rec.firstAt,
          $plugin_source: pluginSource.RageClick
        };

        if (data.href) props['href'] = data.href;
        if (data.trackId) props['track_id'] = data.trackId;

        // Own-property guard — avoids prototype pollution via …data.attrs spread.
        const attrs: Record<string, unknown> = {};
        for (const k of Object.keys(data.attrs)) {
          if (Object.prototype.hasOwnProperty.call(data.attrs, k)) {
            attrs[k] = data.attrs[k];
          }
        }
        if (Object.keys(attrs).length > 0) props['attrs'] = attrs;

        tracker.track<RageClickType>('$rage_click', props, undefined, EventPriority.Critical);
      }
    } else {
      if (rec) {
        clearTimeout(rec.timer);
        timers.delete(rec.timer);
      }
      records.set(el, {
        count: 1,
        firstAt: now,
        timer: armTimer(el, idleMs)
      });
    }
  });

  return () => {
    unsub();
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
}
