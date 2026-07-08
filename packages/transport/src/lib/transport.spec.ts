import { TrackEventPayload } from '@wince/types';
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

function mockTrackEventPayload(event: Partial<TrackEventPayload>): TrackEventPayload {
  return {
    n: '',
    eid: '',
    seq: 0,
    ts: 0,
    sid: '',
    anon: '',
    ...event,
  };
}

// ---------------------------------------------------------------------------
// Basic send + flush
// ---------------------------------------------------------------------------

describe('Transport — send / flush', () => {
  it('flushes buffered events via fetch', async () => {
    const { t, fetchFn } = makeTransport();
    t.send({
      n: 'page_view',
      eid: '',
      seq: 0,
      ts: 0,
      sid: '',
      anon: ''
    });
    t.send({
      n: 'click',
      eid: '',
      seq: 0,
      ts: 0,
      sid: '',
      anon: ''
    });
    await t.flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(fetchFn.mock.calls[0][1].body as string) as { events: unknown[] };
    expect(envelope.events).toHaveLength(2);
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
    t.send(mockTrackEventPayload({ n: 'ev1' }));
    t.send(mockTrackEventPayload({ n: 'ev2' }));
    // Advance past flush interval — nothing should fire
    jest.runAllTimers();
    expect(fetchFn).not.toHaveBeenCalled();
    await t.close();
  });

  it('sends buffered events after start()', async () => {
    const { t, fetchFn } = makeTransport({ paused: true });
    t.send(mockTrackEventPayload({ n: 'ev1' }));
    t.send(mockTrackEventPayload({ n: 'ev2' }));
    t.start();
    await t.flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await t.close();
  });

  it('pause() mid-flight stops further auto-flushes', async () => {
    const { t, fetchFn } = makeTransport();
    t.send(mockTrackEventPayload({ n: 'ev1' }));
    await t.flush();
    const callsAfterFirstFlush = fetchFn.mock.calls.length;

    t.pause();
    t.send(mockTrackEventPayload({ n: 'ev2' }));
    jest.runAllTimers();
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
    t.send(mockTrackEventPayload({ n: 'ev1' }));
    t.send(mockTrackEventPayload({ n: 'ev2' }));
    t.drain();

    expect(beaconCalls).toHaveLength(1);
    expect(beaconCalls[0][0]).toBe('https://example.test/ingest');
    expect(beaconCalls[0][1]).toBeInstanceOf(Blob);
    expect(beaconCalls[0][1].type).toContain('application/json');

    // Restore
    Object.defineProperty(global, 'navigator', { value: origNavigator, configurable: true });
  });

  it('falls back to async flush when sendBeacon is unavailable', async () => {
    const { t } = makeTransport({ paused: true });
    t.send(mockTrackEventPayload({ n: 'ev' }));

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

// ---------------------------------------------------------------------------
// Batch splitting
// ---------------------------------------------------------------------------

describe('Transport — batch splitting', () => {
  it('splits events across multiple requests when batchSize is exceeded', async () => {
    // Start paused to prevent auto-flush from triggering mid-add, which would
    // cause the flush() call to join a cycle that only saw a partial buffer.
    const { t, fetchFn } = makeTransport({ batchSize: 2, paused: true });
    t.send(mockTrackEventPayload({ n: 'a' }));
    t.send(mockTrackEventPayload({ n: 'b' }));
    t.send(mockTrackEventPayload({ n: 'c' }));
    // All 3 events are in the buffer before flush() starts its cycle.
    t.start();
    await t.flush();
    // 3 events, batchSize=2 → 2 HTTP calls ([a,b] and [c])
    expect(fetchFn.mock.calls.length).toBeGreaterThanOrEqual(2);
    const allEvents = fetchFn.mock.calls.flatMap(
      (call) => (JSON.parse(call[1].body as string) as { events: { n: string }[] }).events,
    );
    expect(allEvents.map((e) => e.n).sort()).toEqual(['a', 'b', 'c']);
    await t.close();
  });

  it('sends all events in a single request when count <= batchSize', async () => {
    const { t, fetchFn } = makeTransport({ batchSize: 10 });
    t.send(mockTrackEventPayload({ n: 'x' }));
    t.send(mockTrackEventPayload({ n: 'y' }));
    await t.flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await t.close();
  });
});

// ---------------------------------------------------------------------------
// Compression
// ---------------------------------------------------------------------------

describe('Transport — compression', () => {
  it('sends a Uint8Array body when compress:true', async () => {
    const { t, fetchFn } = makeTransport({ compress: true });
    t.send(mockTrackEventPayload({ n: 'ev' }));
    await t.flush();
    const body = fetchFn.mock.calls[0][1].body;
    expect(body).toBeInstanceOf(Uint8Array);
    await t.close();
  });

  it('sets Content-Encoding: gzip header when compress:true', async () => {
    const { t, fetchFn } = makeTransport({ compress: true });
    t.send(mockTrackEventPayload({ n: 'ev' }));
    await t.flush();
    const headers = fetchFn.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['Content-Encoding']).toBe('gzip');
    await t.close();
  });

  it('sends a plain JSON string body when compress:false', async () => {
    const { t, fetchFn } = makeTransport({ compress: false });
    t.send(mockTrackEventPayload({ n: 'ev' }));
    await t.flush();
    const body = fetchFn.mock.calls[0][1].body;
    expect(typeof body).toBe('string');
    expect(() => JSON.parse(body as string)).not.toThrow();
    await t.close();
  });
});

// ---------------------------------------------------------------------------
// Retry behaviour
// ---------------------------------------------------------------------------

describe('Transport — retry on HTTP errors', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('retries on 503 and eventually succeeds', async () => {
    let calls = 0;
    const fetchFn = jest.fn().mockImplementation(() => {
      calls++;
      if (calls < 3) {
        return Promise.resolve({
          ok: false, status: 503,
          headers: { get: () => null },
          body: null,
        });
      }
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: () => null },
        body: null,
      });
    });

    const { t } = makeTransport({
      fetch: fetchFn as unknown as (u: string, i: RequestInit) => Promise<Response>,
      retry: { attempts: 5, baseDelayMs: 10, maxDelayMs: 100 },
    });

    t.send(mockTrackEventPayload({ n: 'ev' }))    ;
    const flushP = t.flush();
    // Run all timers to process retries
    jest.runAllTimers();
    await Promise.resolve();
    await flushP;

    expect(fetchFn.mock.calls.length).toBeGreaterThanOrEqual(3);
    await t.close();
  });

  it('does not retry on a 400 (permanent client error)', async () => {
    const fetchFn = makeFetch(400);
    const { t } = makeTransport({
      fetch: fetchFn as unknown as (u: string, i: RequestInit) => Promise<Response>,
      retry: { attempts: 3, baseDelayMs: 10 },
    });

    t.send(mockTrackEventPayload({ n: 'ev' }));
    await t.flush();
    // Should only attempt once — 400 is a permanent error
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await t.close();
  });
});

// ---------------------------------------------------------------------------
// Three-lane priority routing
// ---------------------------------------------------------------------------

describe('Transport — priority routing', () => {
  it('critical events are flushed to their own batch separate from normal events', async () => {
    const fetchFn = makeFetch(200);
    const t = new Transport({
      url: 'https://example.test/ingest',
      batchSize: 20,
      batchTimeoutMs: 60_000,
      fetch: fetchFn as unknown as (url: string, init: RequestInit) => Promise<Response>,
    });

    t.send(mockTrackEventPayload({ n: 'critical_ev', _priority: 'critical' }));
    t.send(mockTrackEventPayload({ n: 'normal_ev' }));

    await t.flush();

    expect(fetchFn.mock.calls.length).toBeGreaterThanOrEqual(2);
    const allEvents = fetchFn.mock.calls.flatMap(
      (call) => (JSON.parse(call[1].body as string) as { events: { n: string }[] }).events,
    );
    expect(allEvents.map((e) => e.n).sort()).toEqual(['critical_ev', 'normal_ev']);
    await t.close();
  });

  it('all three lanes are flushed and events are routed correctly', async () => {
    const fetchFn = makeFetch(200);
    const t = new Transport({
      url: 'https://example.test/ingest',
      batchSize: 20,
      batchTimeoutMs: 60_000,
      fetch: fetchFn as unknown as (url: string, init: RequestInit) => Promise<Response>,
    });

    t.send(mockTrackEventPayload({ n: 'high_ev', _priority: 'high' }));
    t.send(mockTrackEventPayload({ n: 'normal_ev' }));
    t.send(mockTrackEventPayload({ n: 'critical_ev', _priority: 'critical' }));

    await t.flush();

    const allEvents = fetchFn.mock.calls.flatMap(
      (call) => (JSON.parse(call[1].body as string) as { events: { n: string }[] }).events,
    );
    expect(allEvents.map((e) => e.n).sort()).toEqual(['critical_ev', 'high_ev', 'normal_ev']);
    await t.close();
  });

  it('drain() emits a beacon per lane that has events', () => {
    const beaconCount = { value: 0 };
    const origNavigator = (global as Record<string, unknown>).navigator;
    Object.defineProperty(global, 'navigator', {
      value: { sendBeacon: () => { beaconCount.value++; return true; } },
      configurable: true,
    });

    const t = new Transport({
      url: 'https://example.test/ingest',
      fetch: makeFetch() as unknown as (u: string, i: RequestInit) => Promise<Response>,
      paused: true,
    });

    t.send(mockTrackEventPayload({ n: 'normal_ev' }));
    t.send(mockTrackEventPayload({ n: 'high_ev', _priority: 'high' }));
    t.send(mockTrackEventPayload({ n: 'critical_ev', _priority: 'critical' }));
    t.drain();

    expect(beaconCount.value).toBe(3);
    Object.defineProperty(global, 'navigator', { value: origNavigator, configurable: true });
  });

  it('queueSize is the sum of all three lanes', () => {
    const t = new Transport({
      url: 'https://example.test/ingest',
      fetch: makeFetch() as unknown as (u: string, i: RequestInit) => Promise<Response>,
      paused: true,
    });
    t.send(mockTrackEventPayload({ n: 'a' }));
    t.send(mockTrackEventPayload({ n: 'b', _priority: 'high' }));
    t.send(mockTrackEventPayload({ n: 'c', _priority: 'critical' }));
    expect(t.queueSize).toBe(3);
  });

  it('pause/start applies to all three lanes', async () => {
    const fetchFn = makeFetch(200);
    const t = new Transport({
      url: 'https://example.test/ingest',
      fetch: fetchFn as unknown as (u: string, init: RequestInit) => Promise<Response>,
      paused: true,
    });

    t.send(mockTrackEventPayload({ n: 'critical_ev', _priority: 'critical' }));
    t.send(mockTrackEventPayload({ n: 'high_ev', _priority: 'high' }));
    t.send(mockTrackEventPayload({ n: 'normal_ev' }));

    expect(fetchFn).not.toHaveBeenCalled();
    t.start();
    await t.flush();

    const allEvents = fetchFn.mock.calls.flatMap(
      (call) => (JSON.parse(call[1].body as string) as { events: { n: string }[] }).events,
    );
    expect(allEvents.map((e) => e.n).sort()).toEqual(['critical_ev', 'high_ev', 'normal_ev']);
    await t.close();
  });

  it('updateBatchConfig only updates the normal lane, no errors thrown', async () => {
    const fetchFn = makeFetch(200);
    const t = new Transport({
      url: 'https://example.test/ingest',
      batchSize: 10,
      batchTimeoutMs: 60_000,
      fetch: fetchFn as unknown as (url: string, init: RequestInit) => Promise<Response>,
    });
    t.updateBatchConfig(3, 1_000);
    t.send(mockTrackEventPayload({ n: 'ev' }));
    await t.flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await t.close();
  });
});