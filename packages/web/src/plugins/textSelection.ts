import type { WinceClient } from '../client';

/**
 * Text selection plugin.
 *
 * Emits `$text_selection` when the user highlights text on the page.
 * Selection text is intentionally NOT captured — only the length and the
 * tag name of the element the selection originated from are recorded.
 *
 * Intent signals: users who select price text or product description text
 * are comparison-shopping. Targeting them for a discount nudge has higher
 * conversion probability than targeting passive scrollers.
 *
 * Fires on `selectionchange` and `pointerup` so both mouse and keyboard
 * selection paths are covered. Consecutive identical selections are
 * deduplicated with a short time window to avoid gesture spam.
 *
 * @returns A cleanup function that removes the event listener.
 */
export function mountTextSelection(tracker: WinceClient): () => void {
  if (typeof document === 'undefined') return () => undefined;

  let lastSignature = '';
  let lastEmittedAt = 0;

  const handler = () => {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString();
    if (text.length < 2) return;

    const anchor     = sel.anchorNode?.parentElement ?? null;
    const contextTag = anchor?.tagName.toLowerCase() ?? 'unknown';

    // Walk up DOM to find the nearest [data-track] ancestor.
    let contextTrackId: string | undefined;
    let el: Element | null = anchor;
    while (el && el !== document.documentElement) {
      const tid = el.getAttribute('data-track');
      if (tid) { contextTrackId = tid; break; }
      el = el.parentElement;
    }

    // Dedup: include contextTrackId so that equal-length selections in different
    // tracked sections are NOT suppressed. A short time window keeps gesture
    // bursts from spamming while still allowing repeated deliberate selections.
    const signature = `${text.length}:${contextTag}:${contextTrackId ?? ''}`;
    const now = Date.now();
    if (signature === lastSignature && now - lastEmittedAt < 250) return;
    lastSignature = signature;
    lastEmittedAt = now;

    const props: Record<string, unknown> = {
      selected_length:     text.length,
      context_element_tag: contextTag,
      $plugin_source:      'textSelection',
    };
    if (contextTrackId) props['context_track_id'] = contextTrackId;

    tracker.track('$text_selection', props);
  };

  document.addEventListener('pointerup', handler);
  document.addEventListener('selectionchange', handler);

  return () => {
    document.removeEventListener('pointerup', handler);
    document.removeEventListener('selectionchange', handler);
  };
}
