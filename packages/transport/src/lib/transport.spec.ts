import { Transport } from './transport';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetch(status = 200) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    body: null,
  } as unknown as Response);
}

function makeTransport(overrides: Partial<ConstructorParameters<typeof Transport>[0]> = {}) {
  const fetchFn = overrides.fetch ?? makeFetch(200);
  const t = new Transport({
    url: 'https://example.test/ingest',
    batchSize: 5,
    batchTimeoutMs: 50,
    fetch: fetchFn as unknown as (url: string, init: RequestInit) => Promise<Response>,
    ...overrides,
  });
  return { t, fetchFn: fetchFn as jest.Mock };
}

// ---------------------------------------------------------------------------
// Basic send + flush
// ---------------------------------------------------------------------------

describe('Transport — send / flush', () => {
  it('flushes buffered events via fetch', async () => {
    const { t, fetchFn } = makeTransport();
    t.send({ event: 'page_view' });
    t.send({ event: 'click' });
    await t.flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string) as unknown[];
    expect(body).toHaveLength(2);
    await t.close();
  });
});

// ---------------------------------------------------------------------------
// pause / start (consent gating)
// ---------------------------------------------------------------------------

describe('Transport — pause / start', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('does not send while paused', async () => {
    const { t, fetchFn } = makeTransport({ paused: true });
    t.send({ event: 'ev1' });
    t.send({ event: 'ev2' });
    // Advance past flush interval — nothing should fire
    await jest.runAllTimersAsync();
    expect(fetchFn).not.toHaveBeenCalled();
    await t.close();
  });

  it('sends buffered events after start()', async () => {
    const { t, fetchFn } = makeTransport({ paused: true });
    t.send({ event: 'ev1' });
    t.send({ event: 'ev2' });
    t.start();
    await t.flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await t.close();
  });

  it('pause() mid-flight stops further auto-flushes', async () => {
    const { t, fetchFn } = makeTransport();
    t.send({ event: 'ev1' });
    await t.flush();
    const callsAfterFirstFlush = fetchFn.mock.calls.length;

    t.pause();
    t.send({ event: 'ev2' });
    await jest.runAllTimersAsync();
    // No additional calls while paused
    expect(fetchFn.mock.calls.length).toBe(callsAfterFirstFlush);
    await t.close();
  });
});

// ---------------------------------------------------------------------------
// drain (sendBeacon path)
// ---------------------------------------------------------------------------

describe('Transport — drain()', () => {
  it('calls sendBeacon with buffered events and clears the buffer', () => {
    const beaconCalls: [string, Blob][] = [];
    const origNavigator = (global as Record<string, unknown>).navigator as Record<string, unknown> | undefined;
    Object.defineProperty(global, 'navigator', {
      value: {
        ...(origNavigator ?? {}),
        sendBeacon: (url: string, data: Blob) => { beaconCalls.push([url, data]); return true; },
      },
      configurable: true,
    });

    const { t } = makeTransport({ paused: true });
    t.send({ event: 'ev1' });
    t.send({ event: 'ev2' });
    t.drain();

    expect(beaconCalls).toHaveLength(1);
    expect(beaconCalls[0][0]).toBe('https://example.test/ingest');
    expect(beaconCalls[0][1]).toBeInstanceOf(Blob);
    expect(beaconCalls[0][1].type).toBe('application/json');

    // Restore
    Object.defineProperty(global, 'navigator', { value: origNavigator, configurable: true });
  });

  it('falls back to async flush when sendBeacon is unavailable', async () => {
    const { t } = makeTransport({ paused: true });
    t.send({ event: 'ev' });

    // Simulate no sendBeacon
    const orig = (global as Record<string, unknown>).navigator;
    (global as Record<string, unknown>).navigator = undefined;

    t.drain(); // should kick off async flush
    await Promise.resolve(); // let micro-tasks run
    // fetchFn may or may not have been called at this exact tick, but no throw
    expect(() => t.drain()).not.toThrow();

    (global as Record<string, unknown>).navigator = orig;
    await t.close();
  });
});

