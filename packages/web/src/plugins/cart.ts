import type { WinceClient, TrackOptions } from '../client';

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
  name?: string;
  variant_id?: string;
  quantity?:   number;
  price?:      number;
  currency?:   string;
  cart_id?:    string;
  /** Total cart value including all items. */
  cart_value_total?: number;
  /** Number of distinct items in the cart. */
  item_count?: number;
  /** Applied coupon code, if any. */
  coupon_code?: string;
  /** Final order ID — used with `purchase` action. */
  order_id?: string;
  /** Final order revenue — used with `purchase` action. */
  revenue?: number;
  /** Product category — used with `product_view` and `add`. */
  category?: string;
  /** Whether the product is in stock — used with `product_view`. */
  stock_status?: 'in_stock' | 'out_of_stock' | 'low_stock';
  /** Checkout step index — used with `checkout_step` action. */
  step?: number;
  /** Human-readable step label — e.g. `'shipping'`, `'payment'`. */
  step_name?: string;
  /** Any additional properties are forwarded as-is. */
  [key: string]: unknown;
}

// Actions where data loss is costly — routed to the high-priority lane.
const HIGH_PRIORITY_ACTIONS = new Set<string>([
  'add', 'remove', 'purchase', 'checkout_complete',
]);

// Actions that mark the start/continuation of checkout — arm the abandon timer.
const CHECKOUT_IN_PROGRESS_ACTIONS = new Set<string>([
  'checkout_start', 'checkout_step',
]);

// Actions that resolve checkout (success or explicit abandon) — disarm the timer.
const CHECKOUT_RESOLVED_ACTIONS = new Set<string>([
  'purchase', 'checkout_complete', 'checkout_abandon',
]);

export interface CartOptions {
  /**
   * Automatically emit `$cart_checkout_abandon` when a user starts checkout
   * but leaves without completing it. Triggered by:
   * - Tab-local idle for `abandonIdleMs` ms (default 30 s)
   * - Exit-intent (cursor leaves top of viewport) during checkout
   * - `pagehide` while checkout is in progress and not yet purchased
   *
   * Default: `false` (opt-in).
   */
  autoAbandon?: boolean;
  /**
   * Milliseconds of tab inactivity on a checkout page before firing
   * `$cart_checkout_abandon` with `trigger: 'idle'`.
   * Default: `30 000` (30 s).
   */
  abandonIdleMs?: number;
}

/**
 * Auto cart-event plugin.
 *
 * Listens for `wince:cart` CustomEvents dispatched on `document`.
 * The `detail` payload is forwarded as-is as the event properties.
 *
 * High-value actions (`add`, `remove`, `purchase`, `checkout_complete`) are
 * routed to the high-priority transport lane.
 *
 * When `options.autoAbandon` is `true` the plugin also auto-detects checkout
 * abandonment via three composite signals: tab-local idle, exit-intent, and
 * pagehide.
 *
 * @returns A cleanup function that removes the event listener.
 *
 * @example
 * ```ts
 * const cleanup = mountCart(tracker, { autoAbandon: true });
 * ```
 */
const KNOWN_ACTIONS = new Set<string>([
  'add', 'remove', 'update', 'checkout_start', 'checkout_complete',
  'view_cart', 'product_view', 'checkout_step', 'checkout_abandon', 'purchase',
]);

export function mountCart(tracker: WinceClient, options?: CartOptions): () => void {
  if (typeof document === 'undefined') return () => undefined;

  // ── Abandon detection state ───────────────────────────────────────────────
  const autoAbandon  = options?.autoAbandon  ?? false;
  const abandonIdleMs = options?.abandonIdleMs ?? 30_000;

  let _inCheckout      = false;
  let _abandoned       = false;
  let _lastStep:       string | undefined;
  let _cartValueTotal: number | undefined;
  let _checkoutStartAt = 0;
  let _stepStartAt     = 0;
  let _idleTimer:      ReturnType<typeof setTimeout> | undefined;
  let _drainHookRemove: (() => void) | undefined;

  function armAbandon(stepName: string | undefined, cartValue: number | undefined): void {
    _inCheckout  = true;
    _abandoned   = false;
    _lastStep    = stepName;
    _cartValueTotal = cartValue;
    if (_checkoutStartAt === 0) _checkoutStartAt = Date.now();

    // Reset idle countdown on every checkout_step update.
    if (_idleTimer !== undefined) clearTimeout(_idleTimer);
    _idleTimer = setTimeout(() => {
      _idleTimer = undefined;
      fireAbandon('idle');
    }, abandonIdleMs);

    // Register pagehide hook once.
    if (!_drainHookRemove) {
      _drainHookRemove = tracker.addBeforeDrainHook(() => {
        if (_inCheckout && !_abandoned) fireAbandon('pagehide');
      });
    }
  }

  function disarmAbandon(): void {
    _inCheckout      = false;
    _abandoned       = false;
    _checkoutStartAt = 0;
    _stepStartAt     = 0;
    if (_idleTimer !== undefined) {
      clearTimeout(_idleTimer);
      _idleTimer = undefined;
    }
    _drainHookRemove?.();
    _drainHookRemove = undefined;
  }

  function fireAbandon(trigger: 'idle' | 'exit_intent' | 'pagehide'): void {
    if (!_inCheckout || _abandoned) return;
    _abandoned = true;
    if (_idleTimer !== undefined) {
      clearTimeout(_idleTimer);
      _idleTimer = undefined;
    }
    // Clean up drain hook — it has served its purpose.
    _drainHookRemove?.();
    _drainHookRemove = undefined;
    // Reset start time so a subsequent checkout attempt gets a fresh clock.
    const timeSpent = Math.round((Date.now() - _checkoutStartAt) / 1_000);
    _checkoutStartAt = 0;
    tracker.track(
      '$cart_checkout_abandon',
      {
        last_step:          _lastStep,
        cart_value_total:   _cartValueTotal,
        time_spent_seconds: timeSpent,
        trigger,
        $plugin_source:     'cart',
      },
      undefined,
      { priority: 'critical' },
    );
  }

  // Exit-intent during checkout: cursor leaves top of viewport.
  const onMouseOut = (e: MouseEvent): void => {
    if (!autoAbandon || !_inCheckout || _abandoned) return;
    if (e.clientY > 0) return;
    fireAbandon('exit_intent');
  };

  if (autoAbandon) {
    document.addEventListener('mouseout', onMouseOut);
  }

  // ── Main CustomEvent handler ───────────────────────────────────────────────
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<CartEventDetail>).detail;
    if (!detail || typeof detail !== 'object') return;
    const { action, ...rest } = detail;
    if (!KNOWN_ACTIONS.has(action)) return;

    const trackOpts: TrackOptions | undefined = HIGH_PRIORITY_ACTIONS.has(action)
      ? { priority: 'high' }
      : undefined;

    const stepProps: Record<string, unknown> = {};
    if (action === 'checkout_step' && _stepStartAt > 0) {
      stepProps['time_on_step_ms'] = Date.now() - _stepStartAt;
    }
    tracker.track(`$cart_${action}`, { ...rest, ...stepProps, $plugin_source: 'cart' }, undefined, trackOpts);
    if (action === 'checkout_start' || action === 'checkout_step') _stepStartAt = Date.now();

    if (autoAbandon) {
      if (CHECKOUT_IN_PROGRESS_ACTIONS.has(action)) {
        const cartValue = typeof rest['cart_value_total'] === 'number'
          ? (rest['cart_value_total'] as number)
          : undefined;
        const stepName = typeof rest['step_name'] === 'string'
          ? (rest['step_name'] as string)
          : action === 'checkout_start' ? 'start' : undefined;
        armAbandon(stepName, cartValue);
      } else if (CHECKOUT_RESOLVED_ACTIONS.has(action)) {
        disarmAbandon();
      }
    }
  };

  document.addEventListener('wince:cart', handler);

  return () => {
    document.removeEventListener('wince:cart', handler);
    if (autoAbandon) {
      document.removeEventListener('mouseout', onMouseOut);
      disarmAbandon();
    }
  };
}

