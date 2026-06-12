import type { WinceClient } from '../client';

/**
 * Expected shape of the `wince:cart` CustomEvent detail.
 * Dispatch this from your cart UI to automatically capture cart events.
 *
 * @example
 * ```ts
 * document.dispatchEvent(new CustomEvent('wince:cart', {
 *   detail: {
 *     action:     'add',
 *     product_id: 'SKU-123',
 *     price:      49.99,
 *     quantity:   1,
 *     currency:   'USD',
 *   },
 * }));
 * ```
 */
export interface CartEventDetail {
  /** The cart action. */
  action: 'add' | 'remove' | 'update' | 'checkout_start' | 'checkout_complete';
  product_id?: string;
  variant_id?: string;
  quantity?:   number;
  price?:      number;
  currency?:   string;
  cart_id?:    string;
  /** Any additional properties are forwarded as-is. */
  [key: string]: unknown;
}

/**
 * Auto cart-event plugin.
 *
 * Listens for `wince:cart` CustomEvents dispatched on `document`.
 * The `detail` payload is forwarded as-is as the event properties.
 *
 * @returns A cleanup function that removes the event listener.
 *
 * @example
 * ```ts
 * const cleanup = mountCart(tracker);
 * ```
 */
const KNOWN_ACTIONS = new Set<string>([
  'add', 'remove', 'update', 'checkout_start', 'checkout_complete',
]);

export function mountCart(tracker: WinceClient): () => void {
  if (typeof document === 'undefined') return () => undefined;

  const handler = (e: Event) => {
    const detail = (e as CustomEvent<CartEventDetail>).detail;
    if (!detail || typeof detail !== 'object') return;
    const { action, ...rest } = detail;
    if (!KNOWN_ACTIONS.has(action)) return;
    tracker.track(`$cart_${action}`, { ...rest, $plugin_source: 'cart' });
  };

  document.addEventListener('wince:cart', handler);

  return () => document.removeEventListener('wince:cart', handler);
}
