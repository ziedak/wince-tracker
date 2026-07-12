import { mountCopyPaste } from '../../src/plugins/copyPaste.js';

describe('mountCopyPaste', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('captures copy from input value', () => {
    const input = document.createElement('input');
    input.value = 'PROMO123';
    document.body.appendChild(input);

    const tracker: any = { track: jest.fn() };
    const cleanup = mountCopyPaste(tracker);

    // Dispatch on the input so handler reads input.value
    input.dispatchEvent(new Event('copy', { bubbles: true }));

    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.track).toHaveBeenCalledWith('$copy', expect.objectContaining({ tag: 'input', text: 'PROMO123' }));

    cleanup();
  });
});
