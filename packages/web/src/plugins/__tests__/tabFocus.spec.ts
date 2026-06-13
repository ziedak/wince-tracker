/** @jest-environment jsdom */
import { mountTabFocus } from '../tabFocus';

function setVisibility(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    writable: true,
    configurable: true,
    value: hidden,
  });
}

describe('mountTabFocus — legacy mode (rollupIntervalMs: 0)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setVisibility(false);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    setVisibility(false);
  });

  it('emits $tab_blur when tab becomes hidden', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTabFocus(tracker, { rollupIntervalMs: 0 });

    setVisibility(true);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(tracker.track).toHaveBeenCalledWith('$tab_blur', { $plugin_source: 'tabFocus' });
    cleanup();
  });

  it('emits $tab_focus with away_duration_ms when tab becomes visible after a blur', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTabFocus(tracker, { rollupIntervalMs: 0 });

    jest.setSystemTime(1_000);
    setVisibility(true);
    document.dispatchEvent(new Event('visibilitychange'));

    jest.setSystemTime(4_000);
    setVisibility(false);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(tracker.track).toHaveBeenCalledTimes(2);
    expect(tracker.track).toHaveBeenNthCalledWith(2, '$tab_focus', expect.objectContaining({
      away_duration_ms: expect.any(Number),
      $plugin_source:   'tabFocus',
    }));
    cleanup();
  });

  it('does not emit $tab_focus when visibilitychange fires visible without a prior blur', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTabFocus(tracker, { rollupIntervalMs: 0 });

    setVisibility(false);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(tracker.track).not.toHaveBeenCalled();
    cleanup();
  });

  it('does not emit duplicate blur events while the tab remains hidden', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTabFocus(tracker, { rollupIntervalMs: 0 });

    setVisibility(true);
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.track).toHaveBeenCalledWith('$tab_blur', { $plugin_source: 'tabFocus' });
    cleanup();
  });

  it('removes listener on cleanup', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTabFocus(tracker, { rollupIntervalMs: 0 });
    cleanup();

    setVisibility(true);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(tracker.track).not.toHaveBeenCalled();
  });
});

describe('mountTabFocus — rollup mode', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setVisibility(false);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    setVisibility(false);
  });

  it('does not emit during the window if no blur happened', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTabFocus(tracker, { rollupIntervalMs: 60_000 });

    jest.advanceTimersByTime(60_000);

    expect(tracker.track).not.toHaveBeenCalled();
    cleanup();
  });

  it('emits $tab_focus_rollup with counts after interval when blur occurred', () => {
    const tracker: any = { track: jest.fn() };
    jest.setSystemTime(0);
    const cleanup = mountTabFocus(tracker, { rollupIntervalMs: 60_000 });

    // Blur at t=10s
    jest.setSystemTime(10_000);
    setVisibility(true);
    document.dispatchEvent(new Event('visibilitychange'));

    // Focus at t=20s (10s away)
    jest.setSystemTime(20_000);
    setVisibility(false);
    document.dispatchEvent(new Event('visibilitychange'));

    // Advance to interval boundary
    jest.setSystemTime(60_000);
    jest.advanceTimersByTime(60_000);

    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.track).toHaveBeenCalledWith('$tab_focus_rollup', expect.objectContaining({
      blur_count:     1,
      away_ms:        expect.any(Number),
      $plugin_source: 'tabFocus',
      reason:         'interval',
    }));
    cleanup();
  });

  it('emits $tab_focus_rollup with reason pagehide on page unload', () => {
    const tracker: any = { track: jest.fn() };
    jest.setSystemTime(0);
    const cleanup = mountTabFocus(tracker, { rollupIntervalMs: 60_000 });

    jest.setSystemTime(5_000);
    setVisibility(true);
    document.dispatchEvent(new Event('visibilitychange'));

    jest.setSystemTime(15_000);
    setVisibility(false);
    document.dispatchEvent(new Event('visibilitychange'));

    window.dispatchEvent(new Event('pagehide'));

    expect(tracker.track).toHaveBeenCalledWith('$tab_focus_rollup', expect.objectContaining({
      blur_count: 1,
      reason:     'pagehide',
    }));
    cleanup();
  });

  it('removes listeners on cleanup and clears the interval', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTabFocus(tracker, { rollupIntervalMs: 60_000 });
    cleanup();

    setVisibility(true);
    document.dispatchEvent(new Event('visibilitychange'));
    jest.advanceTimersByTime(60_000);

    expect(tracker.track).not.toHaveBeenCalled();
  });

  it('accumulates multiple blur/focus cycles across a window', () => {
    const tracker: any = { track: jest.fn() };
    jest.setSystemTime(0);
    const cleanup = mountTabFocus(tracker, { rollupIntervalMs: 60_000 });

    for (let i = 1; i <= 3; i++) {
      jest.setSystemTime(i * 10_000);
      setVisibility(true);
      document.dispatchEvent(new Event('visibilitychange'));
      jest.setSystemTime(i * 10_000 + 2_000);
      setVisibility(false);
      document.dispatchEvent(new Event('visibilitychange'));
    }

    jest.setSystemTime(60_000);
    jest.advanceTimersByTime(60_000);

    expect(tracker.track).toHaveBeenCalledWith('$tab_focus_rollup', expect.objectContaining({
      blur_count: 3,
    }));
    cleanup();
  });
});
