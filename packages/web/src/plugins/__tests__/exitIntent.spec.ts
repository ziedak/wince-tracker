import { mountExitIntent } from '../exitIntent';

describe('mountExitIntent', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('fires $exit_intent when cursor leaves top of viewport', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountExitIntent(tracker);

    const ev = new MouseEvent('mouseout', { bubbles: true, clientY: -5 });
    document.dispatchEvent(ev);

    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.track).toHaveBeenCalledWith('$exit_intent', expect.objectContaining({ page: expect.any(String) }));

    // second event ignored
    document.dispatchEvent(ev);
    expect(tracker.track).toHaveBeenCalledTimes(1);

    cleanup();
  });
});
