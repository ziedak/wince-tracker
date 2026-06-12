import type { WinceClient } from '../client';
import { isSafeValue } from './_click-utils';

// ---------------------------------------------------------------------------
// PII-safe text scrubbing
// ---------------------------------------------------------------------------

const TEXT_MAX = 100;

function safeTrim(s: string): string | null {
  const t = s.trim().replace(/\s+/g, ' ').slice(0, TEXT_MAX);
  if (!t || !isSafeValue(t)) return null;
  return t;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Copy/paste tracking plugin.
 *
 * Captures `$copy` and `$cut` events with enough context to identify promo
 * code usage without capturing PII:
 *
 * - Text is capped at 100 chars and scrubbed for CC/SSN patterns
 * - Only direct text content and form input values are captured
 * - Password/cc fields are excluded
 *
 * @returns A cleanup function that removes all event listeners.
 */
export function mountCopyPaste(tracker: WinceClient): () => void {
  if (typeof document === 'undefined') return () => undefined;

  // Fields we never read from.
  const EXCLUDED_TYPES = new Set(['password', 'hidden']);
  const EXCLUDED_AC = new Set([
    'cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year',
    'cc-name', 'cc-type', 'current-password', 'new-password',
  ]);

  function isExcluded(el: HTMLInputElement): boolean {
    if (EXCLUDED_TYPES.has(el.type)) return true;
    if (EXCLUDED_AC.has((el.autocomplete ?? '').toLowerCase())) return true;
    return false;
  }

  const handler = (e: ClipboardEvent) => {
    const target = e.target as Element | null;
    if (!target) return;

    const tag = target.tagName.toLowerCase();

    // Prefer reading from the selection (user selected text in a div/span/p/etc).
    // Fall back to the input value (user Ctrl+C in a form field).
    let text: string | null = null;
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (sel && !sel.isCollapsed) {
      text = safeTrim(sel.toString());
    } else if (
      tag === 'input' ||
      tag === 'textarea' ||
      target.getAttribute('contenteditable') !== null
    ) {
      if (tag === 'input' && isExcluded(target as HTMLInputElement)) return;
      text = safeTrim((target as HTMLInputElement).value ?? '');
    }

    if (!text) return;

    const action = e.type === 'cut' ? 'cut' : 'copy';
    tracker.track(`$${action}`, {
      tag,
      text,
      href: (target as HTMLAnchorElement).href || undefined,
      $plugin_source: 'copyPaste',
    });
  };

  document.addEventListener('copy', handler, { capture: true });
  document.addEventListener('cut', handler, { capture: true });

  return () => {
    document.removeEventListener('copy', handler, { capture: true });
    document.removeEventListener('cut', handler, { capture: true });
  };
}
