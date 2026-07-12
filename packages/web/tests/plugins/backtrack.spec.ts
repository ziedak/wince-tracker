import { mountBacktrack } from '../backtrack';

describe('mountBacktrack', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    // jsdom keeps history state between tests — navigate back to root.
    history.pushState(null, '', '/');
  });

  it('emits $backtrack with from_path and to_path on popstate', () => {
    // Set a known starting path.
    history.replaceState(null, '', '/products');
    const tracker: any = { track: jest.fn() };
    const cleanup = mountBacktrack(tracker);

    // SPA navigation: user goes to /cart.
    history.pushState(null, '', '/cart');

    // User presses back — popstate fires and location reverts to /products.
    history.back();
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(tracker.track).toHaveBeenCalledWith('$backtrack', expect.objectContaining({
      from_path:      '/cart',
      to_path:        expect.any(String),
      $plugin_source: 'backtrack',
    }));

    cleanup();
  });

  it('restores original history.pushState and replaceState on cleanup', () => {
    const origPush    = history.pushState;
    const origReplace = history.replaceState;

    const tracker: any = { track: jest.fn() };
    const cleanup = mountBacktrack(tracker);

    expect(history.pushState).not.toBe(origPush);
    cleanup();
    expect(history.pushState).toBe(origPush);
    expect(history.replaceState).toBe(origReplace);
  });

  it('tracks previousPath across multiple pushState calls', () => {
    history.replaceState(null, '', '/step1');
    const tracker: any = { track: jest.fn() };
    const cleanup = mountBacktrack(tracker);

    history.pushState(null, '', '/step2');
    history.pushState(null, '', '/step3');

    // Simulate back from /step3 → /step2.
    window.dispatchEvent(new PopStateEvent('popstate'));

    const call = tracker.track.mock.calls[0][1];
    expect(call.from_path).toBe('/step3');

    cleanup();
  });

  it('does not emit after cleanup', () => {
    history.replaceState(null, '', '/checkout');
    const tracker: any = { track: jest.fn() };
    const cleanup = mountBacktrack(tracker);
    cleanup();

    history.pushState(null, '', '/cart');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(tracker.track).not.toHaveBeenCalled();
  });
});
