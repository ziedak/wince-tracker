import { mountDoubleSubmit } from '../../src/plugins/doubleSubmit.js';

describe('mountDoubleSubmit', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    document.body.innerHTML = '';
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does NOT emit on a single form submission', () => {
    document.body.innerHTML = `<form id="order-form"></form>`;
    const form = document.getElementById('order-form') as HTMLFormElement;
    const tracker: any = { track: jest.fn() };
    const cleanup = mountDoubleSubmit(tracker);

    form.dispatchEvent(new Event('submit', { bubbles: true }));
    expect(tracker.track).not.toHaveBeenCalled();

    cleanup();
  });

  it('emits $double_submit when same form is submitted twice within windowMs', () => {
    document.body.innerHTML = `<form id="order-form"></form>`;
    const form = document.getElementById('order-form') as HTMLFormElement;
    const tracker: any = { track: jest.fn() };
    const cleanup = mountDoubleSubmit(tracker, { windowMs: 2000 });

    jest.setSystemTime(1_000);
    form.dispatchEvent(new Event('submit', { bubbles: true }));
    jest.setSystemTime(1_800);
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.track).toHaveBeenCalledWith('$double_submit', expect.objectContaining({
      form_id:        'order-form',
      interval_ms:    800,
      $plugin_source: 'doubleSubmit',
    }));

    cleanup();
  });

  it('does NOT emit when second submit is outside windowMs', () => {
    document.body.innerHTML = `<form id="order-form"></form>`;
    const form = document.getElementById('order-form') as HTMLFormElement;
    const tracker: any = { track: jest.fn() };
    const cleanup = mountDoubleSubmit(tracker, { windowMs: 2000 });

    jest.setSystemTime(1_000);
    form.dispatchEvent(new Event('submit', { bubbles: true }));
    jest.setSystemTime(4_000); // 3 s later — outside window
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(tracker.track).not.toHaveBeenCalled();
    cleanup();
  });

  it('does NOT cross-contaminate between different forms', () => {
    document.body.innerHTML = `
      <form id="form-a"></form>
      <form id="form-b"></form>
    `;
    const formA = document.getElementById('form-a') as HTMLFormElement;
    const formB = document.getElementById('form-b') as HTMLFormElement;
    const tracker: any = { track: jest.fn() };
    const cleanup = mountDoubleSubmit(tracker);

    jest.setSystemTime(1_000);
    formA.dispatchEvent(new Event('submit', { bubbles: true }));
    jest.setSystemTime(1_200);
    formB.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(tracker.track).not.toHaveBeenCalled();
    cleanup();
  });
});
