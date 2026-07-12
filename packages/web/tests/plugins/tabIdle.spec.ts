/** @jest-environment jsdom */
import { mountTabIdle } from '../tabIdle';

describe('mountTabIdle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('fires $user_idle after idleMs with no activity', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTabIdle(tracker, { idleMs: 500 });

    jest.advanceTimersByTime(500);

    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.track).toHaveBeenCalledWith(
      '$user_idle',
      expect.objectContaining({ idle_ms: expect.any(Number), $plugin_source: 'tabIdle' }),
    );

    cleanup();
  });

  it('resets the timer on mousemove and does not fire early', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTabIdle(tracker, { idleMs: 500 });

    jest.advanceTimersByTime(300);
    window.dispatchEvent(new MouseEvent('mousemove'));
    jest.advanceTimersByTime(300); // only 300 ms since last activity

    expect(tracker.track).not.toHaveBeenCalled();

    jest.advanceTimersByTime(200); // now 500 ms since last activity
    expect(tracker.track).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('resets the timer on keydown', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTabIdle(tracker, { idleMs: 500 });

    jest.advanceTimersByTime(400);
    window.dispatchEvent(new KeyboardEvent('keydown'));
    jest.advanceTimersByTime(400);

    expect(tracker.track).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);
    expect(tracker.track).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('re-arms after firing so a second idle period also triggers', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTabIdle(tracker, { idleMs: 500 });

    jest.advanceTimersByTime(500); // first idle
    expect(tracker.track).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(500); // second idle
    expect(tracker.track).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it('cleanup cancels the timer and removes listeners', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTabIdle(tracker, { idleMs: 500 });

    jest.advanceTimersByTime(200);
    cleanup();
    jest.advanceTimersByTime(400); // would have fired idle without cleanup

    expect(tracker.track).not.toHaveBeenCalled();
  });

  it('uses default idleMs of 30 000', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTabIdle(tracker);

    jest.advanceTimersByTime(29_999);
    expect(tracker.track).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(tracker.track).toHaveBeenCalledTimes(1);

    cleanup();
  });
});
