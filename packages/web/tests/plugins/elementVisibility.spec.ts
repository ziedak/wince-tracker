import { mountElementVisibility } from '../../src/plugins/elementVisibility.js';

// jsdom doesn't implement IntersectionObserver — we mock it.
type IOCallback = (entries: IntersectionObserverEntry[]) => void;
let _ioCallback: IOCallback | null = null;
const _observed: Element[] = [];
const _unobserved: Element[] = [];

class MockIO {
  constructor(cb: IOCallback) { _ioCallback = cb; }
  observe   = (el: Element) => { _observed.push(el); };
  unobserve = (el: Element) => { _unobserved.push(el); };
  disconnect = jest.fn();
}

beforeAll(() => {
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    configurable: true,
    value: MockIO,
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  _ioCallback = null;
  _observed.length   = 0;
  _unobserved.length = 0;
});

afterEach(() => {
  document.body.innerHTML = '';
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function fireEntry(el: Element, ratio: number, intersecting: boolean): void {
  _ioCallback?.([{
    target:             el,
    intersectionRatio:  ratio,
    isIntersecting:     intersecting,
    boundingClientRect: {} as DOMRectReadOnly,
    intersectionRect:   {} as DOMRectReadOnly,
    rootBounds:         null,
    time:               Date.now(),
  } as IntersectionObserverEntry]);
}

describe('mountElementVisibility', () => {
  it('observes elements matching the default selector on mount', () => {
    document.body.innerHTML = `
      <div data-track-visible="hero" id="hero">Hero</div>
      <div data-track-visible="banner">Banner</div>
    `;
    const tracker: any = { track: jest.fn() };
    const cleanup = mountElementVisibility(tracker);

    expect(_observed).toHaveLength(2);
    cleanup();
  });

  it('emits $element_visible when element leaves viewport after minVisibleMs', () => {
    document.body.innerHTML = `<div data-track-visible="hero" id="hero">Hero</div>`;
    const hero = document.getElementById('hero')!;
    const tracker: any = { track: jest.fn() };

    jest.setSystemTime(1_000);
    const cleanup = mountElementVisibility(tracker, { minVisibleMs: 1000 });

    // Element enters viewport.
    fireEntry(hero, 0.8, true);

    // Advance 1500 ms.
    jest.setSystemTime(2_500);

    // Element leaves viewport — should emit.
    fireEntry(hero, 0, false);

    expect(tracker.track).toHaveBeenCalledWith('$element_visible', expect.objectContaining({
      element_id:      'hero',
      element_tag:     'div',
      $plugin_source:  'elementVisibility',
    }));
    expect(tracker.track.mock.calls[0][1].visible_ms).toBeGreaterThanOrEqual(1000);

    cleanup();
  });

  it('does NOT emit if element was visible for less than minVisibleMs', () => {
    document.body.innerHTML = `<div data-track-visible="flash">Flash</div>`;
    const el = document.querySelector('[data-track-visible="flash"]')!;
    const tracker: any = { track: jest.fn() };

    jest.setSystemTime(1_000);
    const cleanup = mountElementVisibility(tracker, { minVisibleMs: 1000 });

    fireEntry(el, 0.6, true);
    jest.setSystemTime(1_400); // only 400 ms
    fireEntry(el, 0, false);

    expect(tracker.track).not.toHaveBeenCalled();
    cleanup();
  });

  it('unobserves element after first emission when once=true (default)', () => {
    document.body.innerHTML = `<div data-track-visible="item">Item</div>`;
    const el = document.querySelector('[data-track-visible="item"]')!;
    const tracker: any = { track: jest.fn() };

    jest.setSystemTime(0);
    const cleanup = mountElementVisibility(tracker, { minVisibleMs: 500 });

    fireEntry(el, 0.7, true);
    jest.setSystemTime(600);
    fireEntry(el, 0, false);

    expect(_unobserved).toContain(el);
    cleanup();
  });

  it('flushes still-visible elements on cleanup', () => {
    document.body.innerHTML = `<div data-track-visible="sticky">Sticky</div>`;
    const el = document.querySelector('[data-track-visible="sticky"]')!;
    const tracker: any = { track: jest.fn() };

    jest.setSystemTime(0);
    const cleanup = mountElementVisibility(tracker, { minVisibleMs: 500 });

    // Element enters viewport but never leaves before cleanup.
    fireEntry(el, 0.9, true);
    jest.setSystemTime(600);

    cleanup();

    expect(tracker.track).toHaveBeenCalledWith('$element_visible', expect.objectContaining({
      element_id: 'sticky',
    }));
  });
});
