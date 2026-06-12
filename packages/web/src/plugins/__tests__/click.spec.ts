import { mountClick } from '../click';



describe('mountClick', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('captures clicks and forwards $click to tracker', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Buy now';
    btn.setAttribute('data-track-label', 'Buy');
    btn.setAttribute('data-track-foo', 'bar');
    document.body.appendChild(btn);

    const tracker: any = { track: jest.fn() };

    const cleanup = mountClick(tracker);

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.track).toHaveBeenCalledWith('$click', expect.objectContaining({
      tag: 'button',
      text: 'Buy now',
      label: 'Buy',
      foo: 'bar',
      elements_chain: expect.any(String),
    }));

    cleanup();
  });
});
