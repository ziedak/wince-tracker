import { mountRageClick } from '../../src/plugins/rageClick.js';


describe('mountRageClick', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('emits $rage_click after threshold clicks on a semantic element', () => {
    const el = document.createElement('button');
    el.textContent = 'X';
    document.body.appendChild(el);

    const tracker: any = { track: jest.fn() };
    const cleanup = mountRageClick(tracker);

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
    }), undefined, 2);

    cleanup();
  });

  it('emits $rage_click on a non-semantic pointer surface (frustration case)', () => {
    document.body.innerHTML = `
      <div id="card" style="cursor: pointer; padding: 12px;">
        <span>Product card</span>
      </div>
    `;

    const tracker: any = { track: jest.fn() };
    const cleanup = mountRageClick(tracker, { threshold: 3, windowMs: 750 });

    const card = document.getElementById('card') as HTMLDivElement;
    jest.setSystemTime(1_000);
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.setSystemTime(1_200);
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.setSystemTime(1_400);
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.track).toHaveBeenCalledWith('$rage_click', expect.objectContaining({
      tag: 'div',
      count: 3,
      $plugin_source: 'rageClick',
    }), undefined, 2);

    cleanup();
  });

  it('emits $rage_click on an element with an ARIA role', () => {
    document.body.innerHTML = `<div role="tab" id="tab1">Overview</div>`;
    const tab = document.getElementById('tab1') as HTMLElement;

    const tracker: any = { track: jest.fn() };
    const cleanup = mountRageClick(tracker, { threshold: 3, windowMs: 500 });

    jest.setSystemTime(2_000);
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.setSystemTime(2_100);
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.setSystemTime(2_200);
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(tracker.track).toHaveBeenCalledWith('$rage_click', expect.objectContaining({ tag: 'div', count: 3 }), undefined, 2);

    cleanup();
  });

  it('does not emit when clicks are spread across the windowMs', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);

    const tracker: any = { track: jest.fn() };
    const cleanup = mountRageClick(tracker, { threshold: 3, windowMs: 300 });

    jest.setSystemTime(1_000);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.setSystemTime(1_700); // beyond windowMs — resets
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.setSystemTime(1_800);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(tracker.track).not.toHaveBeenCalled();

    cleanup();
  });
});
