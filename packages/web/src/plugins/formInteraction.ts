import type { WinceClient } from '../client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FormInteractionOptions {
  /**
   * Capture `$form_start` (first field focus or input) and field-level
   * focus/blur events with dwell timing. Default: true.
   */
  captureFieldInteractions?: boolean;
}

// Same autocomplete exclusion as formAbandon.
const EXCLUDED_AUTOCOMPLETE = new Set([
  'cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year',
  'cc-name', 'cc-type', 'current-password', 'new-password',
]);

function isPayment(input: HTMLInputElement): boolean {
  const type = (input.type || 'text').toLowerCase();
  return type === 'password' || EXCLUDED_AUTOCOMPLETE.has((input.autocomplete || '').toLowerCase());
}

function fieldKey(input: HTMLInputElement): string {
  return input.name || input.id || input.type || 'unknown';
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Form interaction plugin.
 *
 * Captures granular form-field behavior — focus timing, blur dwell, and
 * first-interaction signals — so the AI cart-recovery system can
 * distinguish "engaged but abandoned" from "never started."
 *
 * Events emitted:
 * - `$form_start` — first capturable field is focused or modified
 * - `$form_field_focused` — a field gains focus (with `field_name`, `field_type`)
 * - `$form_field_blurred` — a field loses focus (with `dwell_ms`)
 *
 * Payment-card and password fields are excluded.
 *
 * @returns A cleanup function that removes all listeners.
 */
export function mountFormInteraction(
  tracker: WinceClient,
  options: FormInteractionOptions = {},
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => undefined;
  }

  const captureField = options.captureFieldInteractions ?? true;

  // Track fields currently focused so we can compute dwell on blur.
  const active = new Map<HTMLInputElement, number>();
  let _started = false;

  function onFocus(e: FocusEvent): void {
    const input = e.target as HTMLInputElement;
    if (input.tagName !== 'INPUT' && input.tagName !== 'TEXTAREA') return;
    if (isPayment(input)) return;

    if (!_started) {
      _started = true;
      const form = input.form;
      tracker.track('$form_start', {
        form_id:     form?.id         || undefined,
        form_name:   form?.name       || undefined,
        form_action: form?.getAttribute('action') || undefined,
        field_name:  fieldKey(input),
        field_type:  input.type || 'text',
      });
    }

    if (captureField) {
      active.set(input, Date.now());
      tracker.track('$form_field_focused', {
        field_name: fieldKey(input),
        field_type: input.type || 'text',
      });
    }
  }

  function onBlur(e: FocusEvent): void {
    const input = e.target as HTMLInputElement;
    if (input.tagName !== 'INPUT' && input.tagName !== 'TEXTAREA') return;
    if (isPayment(input)) return;

    if (captureField) {
      const entered = active.get(input);
      active.delete(input);
      const props: Record<string, unknown> = {
        field_name: fieldKey(input),
        field_type: input.type || 'text',
      };
      if (entered) props['dwell_ms'] = Date.now() - entered;
      tracker.track('$form_field_blurred', props);
    }
  }

  document.addEventListener('focusin', onFocus);
  document.addEventListener('focusout', onBlur);

  return () => {
    document.removeEventListener('focusin', onFocus);
    document.removeEventListener('focusout', onBlur);
    active.clear();
  };
}
