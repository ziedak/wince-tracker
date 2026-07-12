import { EventPriority } from '@wince/types';
import type { WinceClient } from '../client';
import { ExitIntentType, pluginSource } from './types';

/**
 * Exit-intent detection plugin.
 *
 * Fires `$exit_intent` when the user's cursor leaves the top of the viewport
 * — the classic "about to close the tab or hit the back button" signal.
 * Critical for triggering cart-recovery interventions (modal, email capture).
 *
 * Only fires once per page load. Subsequent exits after re-entering are ignored
 * to prevent noise from accidental cursor exits.
 *
 * @returns A cleanup function that removes the event listener.
 */
export function mountExitIntent(tracker: WinceClient): () => void {
  if (typeof document === 'undefined') return () => undefined;

  let _fired = false;

  const handler = (e: MouseEvent) => {
    if (_fired) return;
    // Only the top edge signals tab-close intent; side/bottom exits are noise.
    if (e.clientY > 0) return;
    _fired = true;
    if (typeof location === 'undefined' || !location.pathname) return;
    tracker.track<ExitIntentType>(
      '$exit_intent',
      {
        page: location.pathname,
        $plugin_source: pluginSource.ExitIntent,
      },
      undefined,
       EventPriority.Critical,
    );
  };

  document.addEventListener('mouseout', handler);

  return () => document.removeEventListener('mouseout', handler);
}
