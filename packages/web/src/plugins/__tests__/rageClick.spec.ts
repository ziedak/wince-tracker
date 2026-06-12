import { mountRageClick } from '../rageClick';


describe('mountRageClick', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('emits $rage_click after threshold clicks on the same element', () => {
    const el = document.createElement('button');
    el.textContent = 'X';
    document.body.appendChild(el);

    const tracker: any = { track: jest.fn() };

    const cleanup = mountRageClick(tracker);

    // Simulate rapid clicks within the default 300ms window.
    jest.setSystemTime(1_000);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.setSystemTime(1_100);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.setSystemTime(1_150);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.track).toHaveBeenCalledWith('$rage_click', expect.objectContaining({
      tag: 'button',
      count: 3,
      elements_chain: expect.any(String),
    }));

    cleanup();
  });
});
