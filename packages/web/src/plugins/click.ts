import type { WinceClient } from '../client';
import { useClickCapture, type ClickData } from './_click-utils';

export type { ClickData };

// Attributes scanned (in order) to find a human-readable label for the click.
const LABEL_ATTRS = ['data-track-label', 'aria-label', 'data-label', 'title'];

function getLabel(el: Element): string | undefined {
  for (const attr of LABEL_ATTRS) {
    const val = el.getAttribute(attr);
    if (val) return val;
  }
  return undefined;
}

/**
 * Auto click-tracking plugin.
 *
 * Only tracks clicks on the element whitelist (`a, button, input[type=submit],
 * input[type=button], label, [role=button], [data-track]`). Password fields and
 * payment-card inputs are silently ignored. Label text is capped at 256 chars.
 *
 * Uses the shared `useClickCapture` dispatcher so `sanitizeClick()` runs
 * exactly once per click even when multiple click plugins are mounted.
 *
 * @returns A cleanup function that removes the event listener.
 */
export function mountClick(tracker: WinceClient): () => void {
  if (typeof document === 'undefined') return () => undefined;

  let _lastMoveAt = 0;
  const onMouseMove = () => { _lastMoveAt = Date.now(); };
  document.addEventListener('mousemove', onMouseMove, { passive: true });

  const removeClickCapture = useClickCapture((data) => {
    const props: Record<string, unknown> = {
      tag:             data.tag,
      text:            data.text,
      elements_chain:  data.elements_chain,
    };

    // Own-property guard — avoids prototype pollution via …data.attrs spread.
    for (const k of Object.keys(data.attrs)) {
      if (Object.prototype.hasOwnProperty.call(data.attrs, k)) {
        props[k] = data.attrs[k];
      }
    }

    if (data.href)    props['href']     = data.href;
    if (data.trackId) props['track_id'] = data.trackId;
    if (data.hasModifier) props['has_modifier'] = data.hasModifier;

    const label = getLabel(data.target as Element);
    if (label) props['label'] = label;

    if (_lastMoveAt > 0) {
      const ms = Date.now() - _lastMoveAt;
      if (ms >= 500) props['hesitation_ms'] = ms;
    }

    tracker.track('$click', { ...props, $plugin_source: 'click' });
  });

  return () => {
    document.removeEventListener('mousemove', onMouseMove);
    removeClickCapture();
  };
}
