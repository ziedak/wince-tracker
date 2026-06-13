import type { WinceClient } from '../client';

// Same PII exclusion set as _click-utils.ts — never report payment/password fields.
const EXCLUDED_AUTOCOMPLETE = new Set([
  'cc-name', 'cc-given-name', 'cc-additional-name', 'cc-family-name',
  'cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc',
  'cc-type', 'current-password', 'new-password',
]);

function isExcluded(input: HTMLInputElement): boolean {
  if (input.type === 'password') return true;
  const ac = (input.autocomplete ?? '').toLowerCase();
  return ac.startsWith('cc-') || EXCLUDED_AUTOCOMPLETE.has(ac);
}

/**
 * Form validation error plugin.
 *
 * Fires `$validation_error` when a form field fails native browser validation
 * (e.g. required field empty, invalid email format, min/max violations).
 *
 * The `validation_message` is the browser-generated constraint message —
 * not user input — so it is safe to capture.
 *
 * Friction signal for the AI model: repeated validation errors on the
 * email or shipping fields predict checkout abandonment. Use as a trigger
 * for a contextual help nudge or autofill suggestion.
 *
 * Note: The `invalid` event does not bubble, so capture mode is required.
 *
 * @returns A cleanup function that removes the event listener.
 */
export function mountValidationError(tracker: WinceClient): () => void {
  if (typeof document === 'undefined') return () => undefined;

  // Dedup: browser fires `invalid` once per field on a single submit click.
  // Two submissions within 100 ms on the same field = one event.
  const _recent = new Map<string, number>();

  const handler = (e: Event) => {
    const input = e.target;
    if (
      !(input instanceof HTMLInputElement) &&
      !(input instanceof HTMLTextAreaElement) &&
      !(input instanceof HTMLSelectElement)
    ) return;

    if (input instanceof HTMLInputElement && isExcluded(input)) return;

    const fieldName  = (input as HTMLInputElement).name || input.id || input.tagName.toLowerCase();
    const formId     = (input as HTMLInputElement).form?.id || undefined;
    const dedupKey   = `${formId ?? ''}:${fieldName}`;
    const now        = Date.now();
    const lastFired  = _recent.get(dedupKey);

    if (lastFired !== undefined && now - lastFired < 100) return;

    // FIFO eviction: cap the map at 50 entries before inserting the new key.
    if (_recent.size >= 50) {
      _recent.delete(_recent.keys().next().value!);
    }
    _recent.set(dedupKey, now);

    const validationMessage = (input as HTMLInputElement).validationMessage || undefined;

    tracker.track('$validation_error', {
      field_name:         fieldName,
      field_type:         (input as HTMLInputElement).type ?? input.tagName.toLowerCase(),
      form_id:            formId,
      validation_message: validationMessage,
      $plugin_source:     'validationError',
    });
  };

  // `invalid` does not bubble — capture is required.
  document.addEventListener('invalid', handler, { capture: true });

  return () => document.removeEventListener('invalid', handler, { capture: true });
}
