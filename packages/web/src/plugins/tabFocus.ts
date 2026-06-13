import type { WinceClient } from '../client';

/**
 * Tab blur/focus plugin.
 *
 * Emits `$tab_blur` when the user switches away from the tab and `$tab_focus`
 * when they return, along with how long they were away.
 *
 * Key intervention trigger: a user returning to the page after leaving is a
 * re-engagement signal — ideal timing for a recovery popup or chat nudge.
 *
 * @returns A cleanup function that removes the visibilitychange listener.
 */
export function mountTabFocus(tracker: WinceClient): () => void {
  if (typeof document === 'undefined') return () => undefined;

  let blurredAt: number | undefined;
  let isBlurred = false;

  const handler = () => {
    if (document.hidden) {
      if (isBlurred) return;
      isBlurred = true;
      blurredAt = Date.now();
      tracker.track('$tab_blur', { $plugin_source: 'tabFocus' });
      return;
    }

    if (!isBlurred) return;

    const props: Record<string, unknown> = { $plugin_source: 'tabFocus' };
    if (blurredAt !== undefined) {
      props['away_duration_ms'] = Date.now() - blurredAt;
    }
    blurredAt = undefined;
    isBlurred = false;
    tracker.track('$tab_focus', props);
  };

  document.addEventListener('visibilitychange', handler);

  return () => document.removeEventListener('visibilitychange', handler);
}
