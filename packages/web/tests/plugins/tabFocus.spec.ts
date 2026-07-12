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

    expect(tracker.track).toHaveBeenCalledWith('$tab_blur', expect.objectContaining({
      blurred_at: expect.any(Number),
      $plugin_source: 'tabFocus',
    }));
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

  it('does not mutate the blur payload when focus is emitted later', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTabFocus(tracker, { rollupIntervalMs: 0 });

    jest.setSystemTime(1_000);
    setVisibility(true);
    document.dispatchEvent(new Event('visibilitychange'));

    const blurPayload = tracker.track.mock.calls[0][1];

    jest.setSystemTime(4_000);
    setVisibility(false);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(blurPayload).toEqual({
      blurred_at: 1_000,
      $plugin_source: 'tabFocus',
    });
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
    expect(tracker.track).toHaveBeenCalledWith('$tab_blur', expect.objectContaining({
      blurred_at: expect.any(Number),
      $plugin_source: 'tabFocus',
    }));
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
    let now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const cleanup = mountTabFocus(tracker, { rollupIntervalMs: 60_000 });

    // Blur at t=10s
    now = 10_000;
    setVisibility(true);
    document.dispatchEvent(new Event('visibilitychange'));

    // Focus at t=20s (10s away)
    now = 20_000;
    setVisibility(false);
    document.dispatchEvent(new Event('visibilitychange'));

    // Advance to interval boundary
    now = 60_000;
    jest.advanceTimersByTime(60_000);

    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.track).toHaveBeenCalledWith('$tab_focus_rollup', expect.objectContaining({
      blur_count:     1,
      away_ms:        10_000,
      focused_ms:     50_000,
      $plugin_source: 'tabFocus',
      reason:         'interval',
    }));
    cleanup();
  });

  it('emits $tab_focus_rollup with reason pagehide on page unload', () => {
    const tracker: any = { track: jest.fn() };
    let now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const cleanup = mountTabFocus(tracker, { rollupIntervalMs: 60_000 });

    now = 5_000;
    setVisibility(true);
    document.dispatchEvent(new Event('visibilitychange'));

    now = 15_000;
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
    let now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const cleanup = mountTabFocus(tracker, { rollupIntervalMs: 60_000 });

    for (let i = 1; i <= 3; i++) {
      now = i * 10_000;
      setVisibility(true);
      document.dispatchEvent(new Event('visibilitychange'));
      now = i * 10_000 + 2_000;
      setVisibility(false);
      document.dispatchEvent(new Event('visibilitychange'));
    }

    now = 60_000;
    jest.advanceTimersByTime(60_000);

    expect(tracker.track).toHaveBeenCalledWith('$tab_focus_rollup', expect.objectContaining({
      blur_count: 3,
      away_ms: expect.any(Number),
      focused_ms: expect.any(Number),
    }));
    expect(tracker.track).toHaveBeenCalledWith('$tab_focus_rollup', expect.objectContaining({
      blur_count: 3,
      away_ms: 6_000,
      focused_ms: 54_000,
      window_ms: 60_000,
      reason: 'interval',
      $plugin_source: 'tabFocus',
    }));
    cleanup();
  });
});
