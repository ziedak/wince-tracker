import type { WinceClient } from '../client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FormAbandonOptions {
  /**
   * Input name/type values to capture when filled.
   * Only these fields are reported — all others are ignored.
   * Default: `['email', 'tel', 'name', 'address', 'city', 'zip']`
   */
  captureFields?: string[];
  /**
   * Input types to always exclude, regardless of `captureFields`.
   * Default: `['password', 'hidden']`
   */
  excludeTypes?: string[];
  /**
   * Minimum `value.trim().length` before a field is considered "filled".
   * Default: `2`
   */
  minLength?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CAPTURE_FIELDS = ['email', 'tel', 'name', 'address', 'city', 'zip'];
const DEFAULT_EXCLUDE_TYPES  = ['password', 'hidden'];
const DEFAULT_MIN_LENGTH     = 2;

// Input autocomplete values that indicate payment data — always excluded.
const EXCLUDED_AUTOCOMPLETE = new Set([
  'cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year',
  'cc-name', 'cc-type', 'current-password', 'new-password',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isExcluded(input: HTMLInputElement, excludeTypes: string[]): boolean {
  const type = (input.type || 'text').toLowerCase();
  if (excludeTypes.includes(type)) return true;
  const ac = (input.autocomplete || '').toLowerCase();
  if (EXCLUDED_AUTOCOMPLETE.has(ac)) return true;
  return false;
}

function getFieldKey(input: HTMLInputElement): string {
  // Prefer `name` attr; fall back to `id`, then `type`.
  return input.name || input.id || input.type || 'unknown';
}

function isCapturable(input: HTMLInputElement, captureFields: string[]): boolean {
  const key  = getFieldKey(input).toLowerCase();
  const type = (input.type || 'text').toLowerCase();
  return captureFields.some(
    (f) => key.includes(f) || type === f,
  );
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Form-abandonment plugin.
 *
 * Fires `$form_abandon` on `pagehide` for every form that:
 * - Has at least one capturable field with enough content
 * - Was NOT submitted before the user left
 *
 * Only field names are captured — never field values.
 *
 * @returns A cleanup function that removes all listeners.
 *
 * @example
 * ```ts
 * const cleanup = mountFormAbandon(tracker);
 * // Pass custom options:
 * const cleanup = mountFormAbandon(tracker, { captureFields: ['email', 'phone'] });
 * ```
 */
export function mountFormAbandon(
  tracker: WinceClient,
  options: FormAbandonOptions = {},
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => undefined;
  }

  const captureFields = options.captureFields ?? DEFAULT_CAPTURE_FIELDS;
  const excludeTypes  = options.excludeTypes  ?? DEFAULT_EXCLUDE_TYPES;
  const minLength     = options.minLength     ?? DEFAULT_MIN_LENGTH;

  // Track which forms have been submitted so we can suppress abandon events.
  const submittedForms = new WeakSet<HTMLFormElement>();

  const onSubmit = (e: Event) => {
    const form = e.currentTarget as HTMLFormElement;
    submittedForms.add(form);
  };

  // Attach submit listeners to all current + future forms.
  const formListeners = new Map<HTMLFormElement, () => void>();

  function attachToForm(form: HTMLFormElement): void {
    if (formListeners.has(form)) return;
    form.addEventListener('submit', onSubmit);
    formListeners.set(form, () => form.removeEventListener('submit', onSubmit));
  }

  // Observe DOM mutations for dynamically added forms.
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of Array.from(m.addedNodes)) {
        if (node instanceof HTMLFormElement) {
          attachToForm(node);
        } else if (node instanceof Element) {
          for (const form of Array.from(node.querySelectorAll('form'))) {
            attachToForm(form as HTMLFormElement);
          }
        }
      }
    }
  });

  // Seed existing forms.
  for (const form of Array.from(document.querySelectorAll('form'))) {
    attachToForm(form as HTMLFormElement);
  }

  observer.observe(document.body ?? document.documentElement, {
    childList: true,
    subtree:   true,
  });

  const onPageHide = () => {
    for (const form of Array.from(document.querySelectorAll('form'))) {
      const f = form as HTMLFormElement;
      if (submittedForms.has(f)) continue;

      const fieldsFilled = new Set<string>();

      for (const el of Array.from(f.elements)) {
        const input = el as HTMLInputElement;
        if (input.tagName !== 'INPUT' && input.tagName !== 'TEXTAREA') continue;
        if (isExcluded(input, excludeTypes)) continue;
        if (!isCapturable(input, captureFields)) continue;
        const val = (input.value || '').trim();
        if (val.length >= minLength) {
          fieldsFilled.add(getFieldKey(input));
        }
      }

      if (fieldsFilled.size === 0) continue;

      tracker.track('$form_abandon', {
        form_id:       f.id                         || undefined,
        form_name:     f.name                       || undefined,
        form_action:   f.getAttribute('action')     || undefined,
        fields_filled: Array.from(fieldsFilled),
        field_count:   fieldsFilled.size,
      });
    }
  };

  window.addEventListener('pagehide', onPageHide);

  return () => {
    window.removeEventListener('pagehide', onPageHide);
    observer.disconnect();
    for (const teardown of formListeners.values()) teardown();
    formListeners.clear();
  };
}
