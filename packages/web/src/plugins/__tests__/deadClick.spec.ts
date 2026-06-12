import { mountDeadClick } from '../deadClick';


describe('mountDeadClick', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('emits $dead_click when no observable effect occurs', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Click';
    document.body.appendChild(btn);

    const tracker: any = { track: jest.fn() };

    const cleanup = mountDeadClick(tracker, {});

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Default timeout is 500ms
    jest.advanceTimersByTime(600);

    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.track).toHaveBeenCalledWith('$dead_click', expect.objectContaining({
      tag: 'button',
      elements_chain: expect.any(String),
      elapsed_ms: expect.any(Number),
    }));

    cleanup();
  });
});
