// -------------------------------------------------------------------------
// Shared click sanitization utility.
// All click-related plugins (mountClick, mountRageClick, etc.) must call
// sanitizeClick() before emitting events. This ensures consistent PII
// exclusions, element whitelisting, and text-length caps across plugins.
// -------------------------------------------------------------------------

export interface ClickData {
  tag:             string;                   // normalised tagName
  text:            string;                   // innerText, capped at TEXT_MAX_LEN chars
  href?:           string;                   // set for <a> elements
  trackId?:        string;                   // value of data-track attribute (if present)
  attrs:           Record<string, string>;   // data-track-* attributes (excluding data-track-label)
  elements_chain:  string;                   // -compatible DOM path for backend querying
  target:          Element;
  hasModifier:     boolean;                  // ctrlKey, metaKey, altKey, or shiftKey held
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

// ---------------------------------------------------------------------------
// $elements_chain — -compatible DOM path serializer
// ---------------------------------------------------------------------------

/** Max ancestors to walk (caps payload size on deeply nested DOMs). */
const CHAIN_MAX_DEPTH = 8;
const CHAIN_TEXT_MAX  = 255;
const HREF_MAX        = 2048;

/** Framework-generated attribute prefixes that change on every build → skip. */
const SKIP_ATTR_PREFIXES = ['_ngcontent', '_nghost', 'data-v-', 'data-reactid'];
/** Attributes handled explicitly or too noisy to include verbatim. */
const SKIP_ATTR_NAMES = new Set(['class', 'id', 'href', 'style']);

// Regex guards: reject values that look like credit card numbers or SSNs.
const CC_RE  = /^(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|6(?:011|5[0-9]{2})[0-9]{12}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|(?:2131|1800|35[0-9]{3})[0-9]{11})$/;
const SSN_RE = /^\d{3}-?\d{2}-?\d{4}$/;

export function isSafeValue(s: string): boolean {
  const stripped = s.replace(/[- ]/g, '');
  return !CC_RE.test(stripped) && !SSN_RE.test(stripped);
}

function escapeChain(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function nthChild(el: Element): number {
  let n = 1;
  let sib = el.previousElementSibling;
  while (sib) { n++; sib = sib.previousElementSibling; }
  return n;
}

function nthOfType(el: Element): number {
  const tag = el.tagName;
  let n = 1;
  let sib = el.previousElementSibling;
  while (sib) { if (sib.tagName === tag) n++; sib = sib.previousElementSibling; }
  return n;
}

function serializeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();

  // tag.class1.class2 (classes sorted for stable output)
  let segment = tag;
  const classes: string[] = [];
  for (const c of Array.from(el.classList)) {
    if (c && !SKIP_ATTR_PREFIXES.some((p) => c.startsWith(p))) {
      classes.push(c.replace(/"/g, ''));
    }
  }
  if (classes.length) segment += '.' + classes.sort().join('.');

  // Attribute dict — sorted alphabetically for stable, diff-friendly output.
  const attrs: Record<string, string> = {};

  // Direct text content (only TEXT_NODEs — avoids pulling in sensitive child elements).
  let directText = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 /* TEXT_NODE */ && node.textContent) {
      directText += node.textContent;
    }
  }
  directText = directText.trim().replace(/\s+/g, ' ').slice(0, CHAIN_TEXT_MAX);
  if (directText && isSafeValue(directText)) attrs['text'] = directText;

  // Positional attrs — always present so backend queries can pin the exact element.
  attrs['nth-child']   = String(nthChild(el));
  attrs['nth-of-type'] = String(nthOfType(el));

  // Special attrs handled outside the general loop ( wire format convention).
  const href = (el as HTMLAnchorElement).href;
  if (href) attrs['href'] = href.slice(0, HREF_MAX);
  if (el.id) attrs['attr_id'] = el.id;

  // All other element attributes, prefixed with `attr__`.
  for (const { name, value } of Array.from(el.attributes)) {
    if (SKIP_ATTR_NAMES.has(name)) continue;
    if (SKIP_ATTR_PREFIXES.some((p) => name.startsWith(p))) continue;
    if (value.length > 1024) continue;       // skip binary blobs / data URIs
    if (!isSafeValue(value)) continue;
    attrs[`attr__${name}`] = value;
  }

  segment += ':';
  segment += Object.entries(attrs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${escapeChain(k)}="${escapeChain(v)}"`)
    .join('');

  return segment;
}

// ---------------------------------------------------------------------------
// $elements_chain cache — WeakMap binds to element lifetime so entries are
// automatically GC'd when the element leaves the DOM. A soft count cap
// protects against pathological SPA patterns (endless carousels creating
// unique elements that never get collected).
// ---------------------------------------------------------------------------

const CHAIN_CACHE_MAX = 200;

let _chainCache = new WeakMap<Element, string>();
let _chainCount = 0;

// DOM mutations can invalidate cached nth-child / nth-of-type positions.
// We reset the entire cache on any childList mutation — cheap (just swap the
// WeakMap) and ensures chains never go stale while keeping cache hits high.
let _mutationWired = false;
let _resetTimer: ReturnType<typeof setTimeout> | undefined;
function _wireMutationReset(): void {
  if (_mutationWired || typeof MutationObserver === 'undefined') return;
  _mutationWired = true;
  const root = document.documentElement;
  if (!root) return;
  new MutationObserver(() => {
    // Debounce: React re-renders can fire dozens of mutations per frame.
    // A single reset after the dust settles preserves cache hit rates.
    if (_resetTimer !== undefined) return;
    _resetTimer = setTimeout(() => {
      _chainCache = new WeakMap();
      _chainCount = 0;
      _resetTimer = undefined;
    }, 50);
  }).observe(root, { childList: true, subtree: true });
}

function _buildElementsChain(el: Element): string {
  const segments: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && cur.tagName.toLowerCase() !== 'body' && depth < CHAIN_MAX_DEPTH) {
    segments.push(serializeElement(cur));
    cur = cur.parentElement;
    depth++;
  }
  return segments.join(';');
}

/**
 * Builds a PostHog-compatible `$elements_chain` string, cached per element.
 * Format: `tag.class:attr="val"nth-child="1";parent_tag:nth-child="3"...`
 */
export function buildElementsChain(el: Element): string {
  _wireMutationReset();
  const cached = _chainCache.get(el);
  if (cached) return cached;

  // Safety valve: if the map grows beyond the cap (e.g. an SPA with infinite
  // carousel that prevents GC), swap for a fresh map. The old map and all its
  // entries become eligible for collection immediately.
  if (_chainCount >= CHAIN_CACHE_MAX) {
    _chainCache = new WeakMap();
    _chainCount = 0;
  }

  const chain = _buildElementsChain(el);
  _chainCache.set(el, chain);
  _chainCount++;
  return chain;
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
  // Check the element AND any ancestor container for explicit opt-out.
  // e.g. <div data-track="false"><button>Buy</button></div> must be suppressed.
  if (el.closest('[data-track="false"]')) return null;
  if (isExcludedInput(el)) return null;

  const tag     = el.tagName.toLowerCase();
  const rawText = ((el as HTMLElement).innerText || (el as HTMLElement).textContent || '').trim();
  const text    = rawText.slice(0, TEXT_MAX_LEN);
  const href    = (el as HTMLAnchorElement).href || undefined;
  const trackId = el.getAttribute('data-track') || undefined;

  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith('data-track-') && attr.name !== 'data-track-label') {
      attrs[attr.name.slice('data-track-'.length)] = attr.value;
    }
  }

  return { tag, text, href, trackId, attrs, elements_chain: buildElementsChain(el), target: el, hasModifier: event.ctrlKey || event.metaKey || event.altKey || event.shiftKey };
}

// ---------------------------------------------------------------------------
// Shared click capture dispatcher
//
// Multiple plugins (click, rageClick, deadClick, etc.) consume click events.
// Rather than each attaching its own `document.addEventListener('click', ...)`,
// we maintain a single shared listener. sanitizeClick() runs exactly once per
// click and fans out to all registered consumers.
// ---------------------------------------------------------------------------

type ClickConsumer = (data: ClickData) => void;

const _consumers = new Set<ClickConsumer>();
let _clickListenerAttached = false;

function _dispatchClick(e: MouseEvent): void {
  let data: ClickData | null;
  try {
    data = sanitizeClick(e);
  } catch {
    return; // malformed element / detached target — skip
  }
  if (!data) return;
  for (const fn of _consumers) {
    try {
      fn(data);
    } catch {
      // consumer threw — don't break other consumers
    }
  }
}

/**
 * Subscribe to sanitized click data from the shared dispatcher.
 * The underlying `document.addEventListener('click', capture)` is created
 * lazily on first subscription and removed when the last consumer unsubscribes.
 *
 * @returns An unsubscribe function.
 */
export function useClickCapture(fn: ClickConsumer): () => void {
  _consumers.add(fn);
  if (!_clickListenerAttached && typeof document !== 'undefined') {
    _clickListenerAttached = true;
    document.addEventListener('click', _dispatchClick, { capture: true });
  }
  return () => {
    _consumers.delete(fn);
    if (_consumers.size === 0 && _clickListenerAttached) {
      document.removeEventListener('click', _dispatchClick, { capture: true });
      _clickListenerAttached = false;
    }
  };
}
