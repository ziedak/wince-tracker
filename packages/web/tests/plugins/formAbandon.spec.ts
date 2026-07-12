import { mountFormAbandon } from '../../src/plugins/formAbandon.js';

describe('mountFormAbandon', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('fires $form_abandon for dirty, unsubmitted forms on pagehide (before-drain hook)', () => {
    const form = document.createElement('form');
    form.id = 'f1';
    const input = document.createElement('input');
    input.name = 'email';
    input.value = 'a@b.com';
    form.appendChild(input);
    document.body.appendChild(form);
    let registeredHook: (() => void) | undefined;
    const tracker: any = {
      track: jest.fn(),
      addBeforeDrainHook: (fn: () => void) => { registeredHook = fn; return () => { registeredHook = undefined; }; },
    };

    const cleanup = mountFormAbandon(tracker);

    // Simulate typing
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Trigger the before-drain hook to simulate pagehide
    expect(typeof registeredHook).toBe('function');
    registeredHook!();

    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.track).toHaveBeenCalledWith('$form_abandon', expect.objectContaining({ form_id: 'f1', fields_filled: expect.any(Array) }), undefined, 1);

    cleanup();
  });
});
