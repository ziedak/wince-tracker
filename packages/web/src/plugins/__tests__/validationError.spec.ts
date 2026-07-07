import { mountValidationError } from '../validationError';

describe('mountValidationError', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('emits $validation_error when a required input fails validation', () => {
    document.body.innerHTML = `
      <form id="checkout-form">
        <input name="email" type="email" required id="email-input" />
      </form>
    `;
    const input = document.getElementById('email-input') as HTMLInputElement;
    Object.defineProperty(input, 'validationMessage', { value: 'Please fill in this field.', configurable: true });

    const tracker: any = { track: jest.fn() };
    const cleanup = mountValidationError(tracker);

    input.dispatchEvent(new Event('invalid', { bubbles: false }));

    expect(tracker.track).toHaveBeenCalledWith('$validation_error', expect.objectContaining({
      field_name:         'email',
      field_type:         'email',
      form_id:            'checkout-form',
      validation_message: 'Please fill in this field.',
      $plugin_source:     'validationError',
    }));

    cleanup();
  });

  it('does NOT emit for password fields', () => {
    document.body.innerHTML = `<input name="pass" type="password" id="pw" />`;
    const input = document.getElementById('pw') as HTMLInputElement;
    const tracker: any = { track: jest.fn() };
    const cleanup = mountValidationError(tracker);

    input.dispatchEvent(new Event('invalid', { bubbles: false }));
    expect(tracker.track).not.toHaveBeenCalled();

    cleanup();
  });

  it('deduplicates rapid invalid events on the same field', () => {
    jest.useFakeTimers();
    document.body.innerHTML = `<form id="f"><input name="email" type="email" id="e" /></form>`;
    const input = document.getElementById('e') as HTMLInputElement;

    const tracker: any = { track: jest.fn() };
    const cleanup = mountValidationError(tracker);

    // Two fires within 100 ms — should only produce one event.
    jest.setSystemTime(1_000);
    input.dispatchEvent(new Event('invalid', { bubbles: false }));
    jest.setSystemTime(1_050);
    input.dispatchEvent(new Event('invalid', { bubbles: false }));

    expect(tracker.track).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
    cleanup();
  });

  it('does not deduplicate distinct controls that share the same name', () => {
    jest.useFakeTimers();
    document.body.innerHTML = `
      <form id="f">
        <input name="choice" type="text" id="choice-a" />
        <input name="choice" type="text" id="choice-b" />
      </form>
    `;
    const first = document.getElementById('choice-a') as HTMLInputElement;
    const second = document.getElementById('choice-b') as HTMLInputElement;

    const tracker: any = { track: jest.fn() };
    const cleanup = mountValidationError(tracker);

    jest.setSystemTime(1_000);
    first.dispatchEvent(new Event('invalid', { bubbles: false }));
    second.dispatchEvent(new Event('invalid', { bubbles: false }));

    expect(tracker.track).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
    cleanup();
  });

  it('removes listener on cleanup', () => {
    document.body.innerHTML = `<input name="field" type="text" id="f" />`;
    const input = document.getElementById('f') as HTMLInputElement;
    const tracker: any = { track: jest.fn() };
    const cleanup = mountValidationError(tracker);
    cleanup();

    input.dispatchEvent(new Event('invalid', { bubbles: false }));
    expect(tracker.track).not.toHaveBeenCalled();
  });
});
