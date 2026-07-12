import { mountPageView } from '../pageView';


describe('mountPageView', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('fires a page() on mount and on navigation', () => {
    const tracker: any = { page: jest.fn(), addBeforeDrainHook: () => () => {/**  */} };
    const cleanup = mountPageView(tracker as any, {});

    expect(tracker.page).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(tracker.page).toHaveBeenCalledTimes(2);

    cleanup();
  });
});
