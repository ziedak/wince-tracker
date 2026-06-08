import type { WinceClient } from '../client';
import { sanitizeClick, type ClickData } from './_click-utils';

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
 * @returns A cleanup function that removes the event listener.
 */
export function mountClick(tracker: WinceClient): () => void {
  if (typeof document === 'undefined') return () => undefined;

  const handler = (e: MouseEvent) => {
    const data = sanitizeClick(e);
    if (!data) return;

    const props: Record<string, unknown> = {
      tag:  data.tag,
      text: data.text,
      ...data.attrs,
    };

    if (data.href)    props['href']     = data.href;
    if (data.trackId) props['track_id'] = data.trackId;

    const label = getLabel(data.target as Element);
    if (label) props['label'] = label;

    tracker.track('$click', props);
  };

  document.addEventListener('click', handler, { capture: true });

  return () => document.removeEventListener('click', handler, { capture: true });
}
