import type { WinceClient } from '../client';

/**
 * Back-navigation (backtrack) plugin.
 *
 * Fires `$backtrack` whenever the user navigates backwards (or forwards) via
 * the browser history — pressing the back button, calling `history.back()`,
 * or any programmatic `popstate` trigger.
 *
 * Checkout abandonment signal: a `$backtrack` event from `/checkout/payment`
 * to `/checkout/shipping` (or to `/`) is one of the highest-confidence
 * abandonment precursors available without server-side session analysis.
 *
 * The plugin patches `history.pushState` and `history.replaceState` to
 * accurately track `from_path` across SPA navigations. Both are restored
 * verbatim on cleanup.
 *
 * @returns A cleanup function that restores history methods and removes listeners.
 */
export function mountBacktrack(tracker: WinceClient): () => void {
  if (typeof window === 'undefined') return () => undefined;

  // Save originals before patching so cleanup can restore the exact same references.
  const origPush    = history.pushState;
  const origReplace = history.replaceState;

  let previousPath = location.pathname + location.search + location.hash;

  // Patch pushState so SPA navigations update previousPath.
  history.pushState = function (
    data:   unknown,
    unused: string,
    url?:   string | URL | null,
  ): void {
    origPush.call(history, data, unused, url);
    previousPath = location.pathname + location.search + location.hash;
  };

  // Patch replaceState so URL-cleanup navigations (query rewrites, etc.)
  // also keep previousPath in sync.
  history.replaceState = function (
    data:   unknown,
    unused: string,
    url?:   string | URL | null,
  ): void {
    origReplace.call(history, data, unused, url);
    previousPath = location.pathname + location.search + location.hash;
  };

  const onPopstate = () => {
    const from = previousPath;
    const to   = location.pathname + location.search + location.hash;
    tracker.track('$backtrack', {
      from_path:      from,
      to_path:        to,
      $plugin_source: 'backtrack',
    });
    previousPath = to;
  };

  window.addEventListener('popstate', onPopstate);

  return () => {
    window.removeEventListener('popstate', onPopstate);
    history.pushState    = origPush;
    history.replaceState = origReplace;
  };
}
