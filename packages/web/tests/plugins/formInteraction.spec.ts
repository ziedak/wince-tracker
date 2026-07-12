import { mountFormInteraction } from '../../src/plugins/formInteraction.js';


describe('mountFormInteraction', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('emits form start, focus and blur events', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountFormInteraction(tracker);

    const input = document.createElement('input');
    input.name = 'email';
    document.body.appendChild(input);

    // Focus event
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(tracker.track).toHaveBeenCalledWith('$form_start', expect.objectContaining({ field_name: 'email' }));
    expect(tracker.track).toHaveBeenCalledWith('$form_field_focused', expect.objectContaining({ field_name: 'email' }));

    // Simulate dwell time
    jest.setSystemTime(Date.now() + 500);
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    expect(tracker.track).toHaveBeenCalledWith('$form_field_blurred', expect.objectContaining({ field_name: 'email', field_type: expect.any(String) }));

    cleanup();
  });
});
