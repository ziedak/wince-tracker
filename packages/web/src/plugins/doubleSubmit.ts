import type { WinceClient } from '../client';

export interface DoubleSubmitOptions {
  /**
   * Maximum milliseconds between two form submissions that counts as a
   * double-submit. Default: `2000`.
   */
  windowMs?: number;
}

/**
 * Double-submit detection plugin.
 *
 * Fires `$double_submit` when the same form is submitted twice within
 * `windowMs` milliseconds. Covers both click-triggered and keyboard-
 * triggered (Enter key) submissions.
 *
 * Friction signal: users hammering the "Place order" button repeatedly
 * are either experiencing a slow response (network issue) or are confused
 * about form state. Use as a trigger for a "Processing…" reassurance nudge
 * or to surface a loading indicator.
 *
 * Uses the form `submit` event (not button click) so keyboard submits are
 * also captured.
 *
 * @returns A cleanup function that removes the event listener.
 */
export function mountDoubleSubmit(
  tracker: WinceClient,
  options?: DoubleSubmitOptions,
): () => void {
  if (typeof document === 'undefined') return () => undefined;

  const windowMs   = options?.windowMs ?? 2000;
  const lastSubmit = new WeakMap<HTMLFormElement, number>();

  const handler = (e: Event) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;

    const now  = Date.now();
    const last = lastSubmit.get(form);
    lastSubmit.set(form, now);

    if (last !== undefined && now - last <= windowMs) {
      tracker.track('$double_submit', {
        form_id:        form.id     || undefined,
        form_action:    form.action || undefined,
        interval_ms:    now - last,
        $plugin_source: 'doubleSubmit',
      });
    }
  };

  // Capture mode: intercept before default so we record even if the page
  // navigates away on a traditional (non-AJAX) form submission.
  document.addEventListener('submit', handler, { capture: true });

  return () => document.removeEventListener('submit', handler, { capture: true });
}
