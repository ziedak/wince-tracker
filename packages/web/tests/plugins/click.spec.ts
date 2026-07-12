/** @jest-environment jsdom */

import { mountClick } from '../../src/plugins/click.js';

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
      attrs: { foo: 'bar' },
      elements_chain: expect.any(String),
    }));

    cleanup();
  });

  it('includes href, track_id, modifier, and hesitation props when present', () => {
    const link = document.createElement('a');
    link.href = '/pricing';
    link.textContent = 'Pricing';
    link.setAttribute('data-track', 'nav_pricing');
    document.body.appendChild(link);

    const tracker: any = { track: jest.fn() };
    const cleanup = mountClick(tracker);

    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 750);
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));

    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.track).toHaveBeenCalledWith('$click', expect.objectContaining({
      tag: 'a',
      href: expect.stringContaining('/pricing'),
      track_id: 'nav_pricing',
      has_modifier: true,
      hesitation_ms: expect.any(Number),
      elements_chain: expect.any(String),
    }));

    cleanup();
  });

  it('does not add a label when no label attributes are present', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Plain button';
    document.body.appendChild(btn);

    const tracker: any = { track: jest.fn() };
    const cleanup = mountClick(tracker);

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(tracker.track).toHaveBeenCalledWith('$click', expect.not.objectContaining({ label: expect.anything() }));

    cleanup();
  });
});
