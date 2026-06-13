/** @jest-environment jsdom */
import { mountCart } from '../cart';

function makeTracker() {
  return {
    track: jest.fn(),
    addBeforeDrainHook: jest.fn(() => jest.fn()),
  };
}

describe('mountCart — basic forwarding', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('forwards wince:cart CustomEvent detail to tracker with $cart_ prefix', () => {
    const tracker = makeTracker();
    const cleanup = mountCart(tracker);

    document.dispatchEvent(new CustomEvent('wince:cart', {
      detail: { action: 'add', product_id: 'SKU-1', price: 9.99 },
    }));

    expect(tracker.track).toHaveBeenCalledWith(
      '$cart_add',
      expect.objectContaining({ product_id: 'SKU-1', price: 9.99 }),
      undefined,
      expect.objectContaining({ priority: 'high' }),
    );

    cleanup();
  });

  it('routes add/remove/purchase/checkout_complete as high priority', () => {
    const tracker = makeTracker();
    const cleanup = mountCart(tracker);

    for (const action of ['add', 'remove', 'purchase', 'checkout_complete']) {
      tracker.track.mockClear();
      document.dispatchEvent(new CustomEvent('wince:cart', { detail: { action } }));
      expect(tracker.track).toHaveBeenCalledWith(
        `$cart_${action}`,
        expect.any(Object),
        undefined,
        expect.objectContaining({ priority: 'high' }),
      );
    }

    cleanup();
  });

  it('routes non-priority actions without a priority option', () => {
    const tracker = makeTracker();
    const cleanup = mountCart(tracker);

    document.dispatchEvent(new CustomEvent('wince:cart', { detail: { action: 'view_cart' } }));

    expect(tracker.track).toHaveBeenCalledWith(
      '$cart_view_cart',
      expect.any(Object),
      undefined,
      undefined,
    );

    cleanup();
  });

  it('ignores events with unknown actions', () => {
    const tracker = makeTracker();
    const cleanup = mountCart(tracker);

    document.dispatchEvent(new CustomEvent('wince:cart', { detail: { action: 'bogus' } }));

    expect(tracker.track).not.toHaveBeenCalled();
    cleanup();
  });
});

describe('mountCart — autoAbandon', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('arms idle timer on checkout_start and fires abandon with trigger: idle', () => {
    const tracker = makeTracker();
    const cleanup = mountCart(tracker, { autoAbandon: true, abandonIdleMs: 500 });

    document.dispatchEvent(new CustomEvent('wince:cart', {
      detail: { action: 'checkout_start', cart_value_total: 59.99, step_name: 'start' },
    }));

    tracker.track.mockClear();
    jest.advanceTimersByTime(500);

    expect(tracker.track).toHaveBeenCalledWith(
      '$cart_checkout_abandon',
      expect.objectContaining({
        trigger: 'idle',
        cart_value_total: 59.99,
        last_step: 'start',
        $plugin_source: 'cart',
      }),
      undefined,
      expect.objectContaining({ priority: 'critical' }),
    );

    cleanup();
  });

  it('disarms timer on purchase — no abandon fired', () => {
    const tracker = makeTracker();
    const cleanup = mountCart(tracker, { autoAbandon: true, abandonIdleMs: 500 });

    document.dispatchEvent(new CustomEvent('wince:cart', { detail: { action: 'checkout_start' } }));
    document.dispatchEvent(new CustomEvent('wince:cart', { detail: { action: 'purchase' } }));

    tracker.track.mockClear();
    jest.advanceTimersByTime(500);

    const abandonCalls = (tracker.track as jest.Mock).mock.calls.filter(
      ([name]: [string]) => name === '$cart_checkout_abandon',
    );
    expect(abandonCalls).toHaveLength(0);

    cleanup();
  });

  it('fires abandon with trigger: exit_intent when cursor leaves top during checkout', () => {
    const tracker = makeTracker();
    const cleanup = mountCart(tracker, { autoAbandon: true, abandonIdleMs: 30_000 });

    document.dispatchEvent(new CustomEvent('wince:cart', {
      detail: { action: 'checkout_start', cart_value_total: 20 },
    }));

    tracker.track.mockClear();
    document.dispatchEvent(new MouseEvent('mouseout', { clientY: -1 }));

    expect(tracker.track).toHaveBeenCalledWith(
      '$cart_checkout_abandon',
      expect.objectContaining({ trigger: 'exit_intent' }),
      undefined,
      expect.objectContaining({ priority: 'critical' }),
    );

    cleanup();
  });

  it('does not fire abandon twice for the same checkout session', () => {
    const tracker = makeTracker();
    const cleanup = mountCart(tracker, { autoAbandon: true, abandonIdleMs: 500 });

    document.dispatchEvent(new CustomEvent('wince:cart', { detail: { action: 'checkout_start' } }));
    tracker.track.mockClear();

    // First: exit_intent
    document.dispatchEvent(new MouseEvent('mouseout', { clientY: -1 }));
    // Second: idle timer fires
    jest.advanceTimersByTime(500);

    const abandonCalls = (tracker.track as jest.Mock).mock.calls.filter(
      ([name]: [string]) => name === '$cart_checkout_abandon',
    );
    expect(abandonCalls).toHaveLength(1);

    cleanup();
  });

  it('fires abandon via pagehide drain hook when in checkout', () => {
    let drainHook: (() => void) | undefined;
    const tracker = {
      track: jest.fn(),
      addBeforeDrainHook: jest.fn((fn: () => void) => {
        drainHook = fn;
        return jest.fn();
      }),
    };

    const cleanup = mountCart(tracker, { autoAbandon: true, abandonIdleMs: 30_000 });

    document.dispatchEvent(new CustomEvent('wince:cart', {
      detail: { action: 'checkout_start', cart_value_total: 100 },
    }));

    tracker.track.mockClear();
    drainHook?.();

    expect(tracker.track).toHaveBeenCalledWith(
      '$cart_checkout_abandon',
      expect.objectContaining({ trigger: 'pagehide', cart_value_total: 100 }),
      undefined,
      expect.objectContaining({ priority: 'critical' }),
    );

    cleanup();
  });

  it('does not fire abandon when autoAbandon is false (default)', () => {
    const tracker = makeTracker();
    const cleanup = mountCart(tracker); // no autoAbandon option

    document.dispatchEvent(new CustomEvent('wince:cart', { detail: { action: 'checkout_start' } }));
    tracker.track.mockClear();
    jest.advanceTimersByTime(60_000);

    const abandonCalls = (tracker.track as jest.Mock).mock.calls.filter(
      ([name]: [string]) => name === '$cart_checkout_abandon',
    );
    expect(abandonCalls).toHaveLength(0);

    cleanup();
  });
});

