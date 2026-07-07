import type { WinceClient, TrackOptions } from '../client';
import {
  CartActionType,
  CartCheckoutAbandonType,
  CartEventDetail,
  pluginSource,
} from './types';

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

// Actions where data loss is costly — routed to the high-priority lane.
const HIGH_PRIORITY_ACTIONS = new Set<string>([
  'add',
  'remove',
  'purchase',
  'checkout_complete',
  'checkout_abandon',
  'coupon_applied',
  'coupon_failed',
]);

// Actions that mark the start/continuation of checkout — arm the abandon timer.
const CHECKOUT_IN_PROGRESS_ACTIONS = new Set<string>([
  'checkout_start',
  'checkout_step',
]);

// Actions that resolve checkout (success or explicit abandon) — disarm the timer.
const CHECKOUT_RESOLVED_ACTIONS = new Set<string>([
  'purchase',
  'checkout_complete',
  'checkout_abandon',
]);

const ACTIVITY_EVENTS = [
  'mousemove',
  'keydown',
  'scroll',
  'click',
  'touchstart',
] as const;

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
  'add',
  'remove',
  'update',
  'checkout_start',
  'checkout_complete',
  'view_cart',
  'product_view',
  'checkout_step',
  'checkout_abandon',
  'purchase',
  'option_selected',
  'coupon_applied',
  'coupon_failed',
]);

export function mountCart(
  tracker: WinceClient,
  options?: CartOptions,
): () => void {
  if (typeof document === 'undefined') return () => undefined;

  // ── Abandon detection state ───────────────────────────────────────────────
  const autoAbandon = options?.autoAbandon ?? false;
  const abandonIdleMs = options?.abandonIdleMs ?? 30_000;

  let _inCheckout = false;
  let _abandoned = false;
  let _lastStep: string | undefined;
  let _cartValueTotal: number | undefined;
  let _checkoutStartAt = 0;
  let _stepStartAt = 0;
  let _idleTimer: ReturnType<typeof setTimeout> | undefined;
  let _drainHookRemove: (() => void) | undefined;

  function clearIdleTimer(): void {
    if (_idleTimer !== undefined) {
      clearTimeout(_idleTimer);
      _idleTimer = undefined;
    }
  }

  function scheduleIdleTimer(): void {
    clearIdleTimer();
    _idleTimer = setTimeout(() => {
      _idleTimer = undefined;
      fireAbandon('idle');
    }, abandonIdleMs);
  }

  function resetIdleTimer(): void {
    if (!_inCheckout || _abandoned) return;
    scheduleIdleTimer();
  }

  function armAbandon(
    stepName: string | undefined,
    cartValue: number | undefined,
  ): void {
    _inCheckout = true;
    _abandoned = false;
    _lastStep = stepName;
    _cartValueTotal = cartValue;
    if (_checkoutStartAt === 0) _checkoutStartAt = Date.now();

    // Reset idle countdown on each checkout signal.
    scheduleIdleTimer();

    // Register pagehide hook once.
    if (!_drainHookRemove) {
      _drainHookRemove = tracker.addBeforeDrainHook(() => {
        if (_inCheckout && !_abandoned) fireAbandon('pagehide');
      });
    }
  }

  function disarmAbandon(): void {
    _inCheckout = false;
    _abandoned = false;
    _checkoutStartAt = 0;
    _stepStartAt = 0;
    clearIdleTimer();
    _drainHookRemove?.();
    _drainHookRemove = undefined;
  }

  function fireAbandon(trigger: 'idle' | 'exit_intent' | 'pagehide'): void {
    if (!_inCheckout || _abandoned) return;
    _abandoned = true;
    clearIdleTimer();
    // Clean up drain hook — it has served its purpose.
    _drainHookRemove?.();
    _drainHookRemove = undefined;
    // Reset start time so a subsequent checkout attempt gets a fresh clock.
    const timeSpent = Math.round((Date.now() - _checkoutStartAt) / 1_000);
    _checkoutStartAt = 0;
    tracker.track<CartCheckoutAbandonType>(
      '$cart_checkout_abandon',
      {
        last_step: _lastStep,
        cart_value_total: _cartValueTotal,
        time_spent_seconds: timeSpent,
        trigger,
        $plugin_source: pluginSource.Cart,
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

  const onActivity = (): void => {
    if (!autoAbandon) return;
    resetIdleTimer();
  };

  if (autoAbandon) {
    document.addEventListener('mouseout', onMouseOut);
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, {
        passive: true,
        capture: true,
      });
    }
  }

  // ── Main CustomEvent handler ───────────────────────────────────────────────
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<CartEventDetail>).detail;
    if (!detail || typeof detail !== 'object') return;
    const { action, ...rest } = detail;
    if (!KNOWN_ACTIONS.has(action)) return;

    const trackOpts: TrackOptions | undefined = HIGH_PRIORITY_ACTIONS.has(
      action,
    )
      ? { priority: 'high' }
      : undefined;

    const stepProps: Record<string, unknown> = {};
    if (action === 'checkout_step' && _stepStartAt > 0) {
      stepProps['time_on_step_ms'] = Date.now() - _stepStartAt;
    }
    tracker.track<CartActionType>(
      `$cart_${action}`,
      { ...rest, ...stepProps, $plugin_source: pluginSource.Cart },
      undefined,
      trackOpts,
    );
    if (action === 'checkout_start' || action === 'checkout_step')
      _stepStartAt = Date.now();

    if (autoAbandon) {
      if (CHECKOUT_IN_PROGRESS_ACTIONS.has(action)) {
        const cartValue =
          typeof rest['cart_value_total'] === 'number'
            ? (rest['cart_value_total'] as number)
            : undefined;
        const stepName =
          typeof rest['step_name'] === 'string'
            ? (rest['step_name'] as string)
            : action === 'checkout_start'
              ? 'start'
              : undefined;
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
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, onActivity, { capture: true });
      }
      disarmAbandon();
    }
  };
}
