/** @jest-environment jsdom */
import { mountTabFocus } from '../tabFocus';

describe('mountTabFocus', () => {
  function setVisibility(hidden: boolean) {
    Object.defineProperty(document, 'hidden', {
      writable: true,
      configurable: true,
      value: hidden,
    });
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    setVisibility(false);
  });

  it('emits $tab_blur when tab becomes hidden', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTabFocus(tracker);

    setVisibility(true);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(tracker.track).toHaveBeenCalledWith('$tab_blur', { $plugin_source: 'tabFocus' });
    cleanup();
  });

  it('emits $tab_focus with away_duration_ms when tab becomes visible after a blur', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTabFocus(tracker);

    jest.setSystemTime(1_000);
    setVisibility(true);
    document.dispatchEvent(new Event('visibilitychange'));

    jest.setSystemTime(4_000); // 3 seconds later
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
    const cleanup = mountTabFocus(tracker);

    setVisibility(false);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(tracker.track).not.toHaveBeenCalled();

    cleanup();
  });

  it('does not emit duplicate blur events while the tab remains hidden', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTabFocus(tracker);

    setVisibility(true);
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.track).toHaveBeenCalledWith('$tab_blur', { $plugin_source: 'tabFocus' });

    cleanup();
  });

  it('removes listener on cleanup', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountTabFocus(tracker);
    cleanup();

    setVisibility(true);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(tracker.track).not.toHaveBeenCalled();
  });
});
