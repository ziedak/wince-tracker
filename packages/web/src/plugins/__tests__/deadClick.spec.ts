import { mountDeadClick } from '../deadClick';


describe('mountDeadClick', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
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
    jest.advanceTimersByTime(600);

    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.track).toHaveBeenCalledWith('$dead_click', expect.objectContaining({
      tag: 'button',
      elements_chain: expect.any(String),
      elapsed_ms: expect.any(Number),
    }));

    cleanup();
  });

  it('does NOT cancel a pending dead click when a follow-up click arrives', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Broken';
    document.body.appendChild(btn);

    const tracker: any = { track: jest.fn() };
    const cleanup = mountDeadClick(tracker, { timeoutMs: 300 });

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.advanceTimersByTime(100);
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.advanceTimersByTime(400);

    expect(tracker.track).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it('does not emit when a DOM mutation occurs anywhere in the document', async () => {
    document.body.innerHTML = `
      <div id="remote"><span id="counter">0</span></div>
      <button id="btn">Click me</button>
    `;
    const btn = document.getElementById('btn') as HTMLButtonElement;
    const counter = document.getElementById('counter') as HTMLSpanElement;

    const tracker: any = { track: jest.fn() };
    const cleanup = mountDeadClick(tracker, { timeoutMs: 300 });

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    counter.textContent = 'Updated';
    await Promise.resolve();
    jest.advanceTimersByTime(400);

    expect(tracker.track).not.toHaveBeenCalled();

    cleanup();
  });

  it('tracks dead clicks on links by default (ignoreLinks is now false)', () => {
    const a = document.createElement('a');
    a.href = '#broken';
    a.textContent = 'Broken link';
    document.body.appendChild(a);

    const tracker: any = { track: jest.fn() };
    const cleanup = mountDeadClick(tracker, { timeoutMs: 300 });

    a.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.advanceTimersByTime(400);

    expect(tracker.track).toHaveBeenCalledWith('$dead_click', expect.objectContaining({ tag: 'a' }));

    cleanup();
  });

  it('tracks dead clicks on non-semantic pointer surfaces', () => {
    document.body.innerHTML = `<div id="card" style="cursor: pointer;">Card</div>`;
    const card = document.getElementById('card') as HTMLDivElement;

    const tracker: any = { track: jest.fn() };
    const cleanup = mountDeadClick(tracker, { timeoutMs: 300 });

    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    jest.advanceTimersByTime(400);

    expect(tracker.track).toHaveBeenCalledWith('$dead_click', expect.objectContaining({ tag: 'div' }));

    cleanup();
  });
});
