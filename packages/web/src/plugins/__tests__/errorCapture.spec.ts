import { mountErrorCapture } from '../errorCapture';


describe('mountErrorCapture', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('captures window error events and forwards $error', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountErrorCapture(tracker, {});

    const ev: any = new Event('error');
    ev.message = 'Boom';
    ev.filename = 'file.js';
    ev.lineno = 10;
    ev.colno = 2;
    ev.error = new Error('Boom');

    window.dispatchEvent(ev);

    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.track).toHaveBeenCalledWith('$error', expect.objectContaining({ type: 'uncaught', message: 'Boom' }));

    cleanup();
  });

  it('captures unhandledrejection events and deduplicates', () => {
    const tracker: any = { track: jest.fn() };
    const cleanup = mountErrorCapture(tracker, {});

    const ev1: any = new Event('unhandledrejection');
    ev1.reason = new Error('Fail');
    window.dispatchEvent(ev1);

    const ev2: any = new Event('unhandledrejection');
    ev2.reason = new Error('Fail');
    window.dispatchEvent(ev2);

    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.track).toHaveBeenCalledWith('$error', expect.objectContaining({ type: 'unhandled_rejection', message: 'Fail' }));

    cleanup();
  });
});
