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
  action:
    | 'add'
    | 'remove'
    | 'update'
    | 'checkout_start'
    | 'checkout_complete'
    | 'view_cart'
    | 'product_view'
    | 'checkout_step'
    | 'checkout_abandon'
    | 'purchase';
  product_id?: string;
  variant_id?: string;
  quantity?:   number;
  price?:      number;
  currency?:   string;
  cart_id?:    string;
  /** Checkout step index — used with `checkout_step` action. */
  step?:       number;
  /** Human-readable step label — e.g. `'shipping'`, `'payment'`. */
  step_name?:  string;
  /** Final order revenue — used with `purchase` action. */
  revenue?:    number;
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
  'view_cart', 'product_view', 'checkout_step', 'checkout_abandon', 'purchase',
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
