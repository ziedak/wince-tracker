// -------------------------------------------------------------------------
// Shared click sanitization utility.
// All click-related plugins (mountClick, mountRageClick, etc.) must call
// sanitizeClick() before emitting events. This ensures consistent PII
// exclusions, element whitelisting, and text-length caps across plugins.
// -------------------------------------------------------------------------

export interface ClickData {
  tag:      string;                   // normalised tagName
  text:     string;                   // innerText, capped at TEXT_MAX_LEN chars
  href?:    string;                   // set for <a> elements
  trackId?: string;                   // value of data-track attribute (if present)
  attrs:    Record<string, string>;   // data-track-* attributes (excluding data-track-label)
  target:   Element;
}

const WHITELIST_SELECTOR =
  'a, button, input[type=submit], input[type=button], label, [role=button], [data-track]';

const TEXT_MAX_LEN = 256;

const EXCLUDED_AUTOCOMPLETE = new Set([
  'cc-name', 'cc-given-name', 'cc-additional-name', 'cc-family-name',
  'cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc',
  'cc-type', 'current-password', 'new-password',
]);

function isExcludedInput(el: Element): boolean {
  if (el.tagName !== 'INPUT') return false;
  const input = el as HTMLInputElement;
  if (input.type === 'password') return true;
  const ac = (input.autocomplete ?? '').toLowerCase();
  return ac.startsWith('cc-') || EXCLUDED_AUTOCOMPLETE.has(ac);
}

/**
 * Finds the nearest trackable ancestor/self and returns sanitized click data.
 *
 * Returns `null` when:
 * - No element in the whitelist was found
 * - Explicit opt-out via `data-track="false"`
 * - The element is a password or payment-card input (PII guard)
 */
export function sanitizeClick(event: MouseEvent): ClickData | null {
  const el = (event.target as Element | null)?.closest(WHITELIST_SELECTOR);
  if (!el) return null;
  if (el.getAttribute('data-track') === 'false') return null;
  if (isExcludedInput(el)) return null;

  const tag     = el.tagName.toLowerCase();
  const rawText = (el as HTMLElement).innerText?.trim() ?? '';
  const text    = rawText.slice(0, TEXT_MAX_LEN);
  const href    = (el as HTMLAnchorElement).href || undefined;
  const trackId = el.getAttribute('data-track') || undefined;

  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith('data-track-') && attr.name !== 'data-track-label') {
      attrs[attr.name.slice('data-track-'.length)] = attr.value;
    }
  }

  return { tag, text, href, trackId, attrs, target: el };
}
