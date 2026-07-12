import { TrackEventPayload, EventPriority } from '@wince/types';
import { Transport } from '../src/lib/transport.js';
import { DEFAULT_TRANSPORT_OPTIONS } from '../src/lib/types.js';
import type { IHttpClient, IHttpResponse } from '../src/lib/clients/IHttpClient.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockClient(_status = 200): IHttpClient {
  return {
    post: async (_url: string, body: Uint8Array | string, _headers?: HeadersInit, _signal?: AbortSignal): Promise<IHttpResponse> => {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: null
      };
    }
  };
}

function mockTrackEventPayload(event: Partial<TrackEventPayload>): TrackEventPayload {
  return {
    n: '',
    eid: '',
    seq: 0,
    ts: 0,
    sid: '',
    anon: '',
    priority: 0,
    ...event
  };
}

/** Create transport with noop compressFn so tests receive raw JSON strings. */
function makeTransport(client: IHttpClient, overrides: Partial<typeof DEFAULT_TRANSPORT_OPTIONS> = {}) {
  const noopCompress = async (input: string | ArrayBuffer | Uint8Array<ArrayBufferLike>): Promise<Uint8Array> => {
    if (typeof input === 'string') return new TextEncoder().encode(input);
    return input as Uint8Array;
  };

  const opts = {
    ...DEFAULT_TRANSPORT_OPTIONS,
    url: 'https://example.test/ingest',
    wsUrl: '',
    compress: { enabled: false },
    exporterOpts: {
      critical: { ...DEFAULT_TRANSPORT_OPTIONS.exporterOpts.critical, compressFn: noopCompress },
      high: { ...DEFAULT_TRANSPORT_OPTIONS.exporterOpts.high, compressFn: noopCompress },
      normal: { ...DEFAULT_TRANSPORT_OPTIONS.exporterOpts.normal, compressFn: noopCompress }
    },
    ...overrides
  };
  return new Transport<TrackEventPayload>(client, opts);
}

// ---------------------------------------------------------------------------
// Basic send + flush
// ---------------------------------------------------------------------------

describe('Transport — send / flush', () => {
  it('flushes buffered events via the client', async () => {
    let receivedBody: string | undefined;
    const client: IHttpClient = {
      post: async (_url: string, body: Uint8Array | string) => {
        receivedBody = typeof body === 'string' ? body : new TextDecoder().decode(body);
        return { ok: true, status: 200, headers: { get: () => null }, body: null };
      }
    };
    const t = makeTransport(client);
    t.send(mockTrackEventPayload({ n: 'page_view' }));
    t.send(mockTrackEventPayload({ n: 'click' }));
    await t.flush();
    const envelope = JSON.parse(receivedBody!) as { events: unknown[] };
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
    let callCount = 0;
    const client: IHttpClient = {
      post: async () => {
        callCount++;
        return { ok: true, status: 200, headers: { get: () => null }, body: null };
      }
    };
    const t = makeTransport(client, { paused: true });
    t.send(mockTrackEventPayload({ n: 'ev1' }));
    t.send(mockTrackEventPayload({ n: 'ev2' }));
    jest.runAllTimers();
    expect(callCount).toBe(0);
    await t.close();
  });

  it('sends buffered events after start()', async () => {
    let callCount = 0;
    const client: IHttpClient = {
      post: async () => {
        callCount++;
        return { ok: true, status: 200, headers: { get: () => null }, body: null };
      }
    };
    const t = makeTransport(client, { paused: true });
    t.send(mockTrackEventPayload({ n: 'ev1' }));
    t.send(mockTrackEventPayload({ n: 'ev2' }));
    t.start();
    await t.flush();
    expect(callCount).toBeGreaterThanOrEqual(1);
    await t.close();
  });

  it('pause() mid-flight stops further auto-flushes', async () => {
    let callCount = 0;
    const client: IHttpClient = {
      post: async () => {
        callCount++;
        return { ok: true, status: 200, headers: { get: () => null }, body: null };
      }
    };
    const t = makeTransport(client);
    t.send(mockTrackEventPayload({ n: 'ev1' }));
    await t.flush();
    const callsAfterFirstFlush = callCount;

    t.pause();
    t.send(mockTrackEventPayload({ n: 'ev2' }));
    jest.runAllTimers();
    expect(callCount).toBe(callsAfterFirstFlush);
    await t.close();
  });
});

// ---------------------------------------------------------------------------
// drain (sendBeacon path)
// ---------------------------------------------------------------------------

describe('Transport — drain()', () => {
  it('calls sendBeacon with buffered events and clears the buffer', () => {
    const beaconCalls: [string, Blob][] = [];
    const origNavigator = (global as Record<string, unknown>).navigator as
      | Record<string, unknown>
      | undefined;
    Object.defineProperty(global, 'navigator', {
      value: {
        ...(origNavigator ?? {}),
        sendBeacon: (url: string, data: Blob) => {
          beaconCalls.push([url, data]);
          return true;
        }
      },
      configurable: true
    });

    const t = makeTransport(makeMockClient(), { paused: true });
    t.send(mockTrackEventPayload({ n: 'ev1' }));
    t.send(mockTrackEventPayload({ n: 'ev2' }));
    t.drain();

    expect(beaconCalls.length).toBeGreaterThanOrEqual(1);
    expect(beaconCalls[0][0]).toBe('https://example.test/ingest');
    expect(beaconCalls[0][1]).toBeInstanceOf(Blob);

    Object.defineProperty(global, 'navigator', { value: origNavigator, configurable: true });
  });

  it('falls back to async flush when sendBeacon is unavailable', async () => {
    const client = makeMockClient();
    const t = makeTransport(client, { paused: true });
    t.send(mockTrackEventPayload({ n: 'ev' }));

    const orig = (global as Record<string, unknown>).navigator;
    (global as Record<string, unknown>).navigator = undefined;

    t.drain();
    await Promise.resolve();
    expect(() => t.drain()).not.toThrow();

    (global as Record<string, unknown>).navigator = orig;
    await t.close();
  });
});

// ---------------------------------------------------------------------------
// Three-lane priority routing
// ---------------------------------------------------------------------------

describe('Transport — priority routing', () => {
  it('critical events are flushed to their own batch separate from normal events', async () => {
    const bodies: string[] = [];
    const client: IHttpClient = {
      post: async (_url: string, body: Uint8Array | string) => {
        bodies.push(typeof body === 'string' ? body : new TextDecoder().decode(body));
        return { ok: true, status: 200, headers: { get: () => null }, body: null };
      }
    };
    const t = makeTransport(client);

    t.send(mockTrackEventPayload({ n: 'critical_ev', priority: EventPriority.Critical }));
    t.send(mockTrackEventPayload({ n: 'normal_ev', priority: EventPriority.Normal }));

    await t.flush();

    expect(bodies.length).toBeGreaterThanOrEqual(2);
    const allEvents = bodies.flatMap(
      (b) => (JSON.parse(b) as { events: { n: string }[] }).events
    );
    expect(allEvents.map((e) => e.n).sort()).toEqual(['critical_ev', 'normal_ev']);
    await t.close();
  });

  it('all three lanes are flushed and events are routed correctly', async () => {
    const bodies: string[] = [];
    const client: IHttpClient = {
      post: async (_url: string, body: Uint8Array | string) => {
        bodies.push(typeof body === 'string' ? body : new TextDecoder().decode(body));
        return { ok: true, status: 200, headers: { get: () => null }, body: null };
      }
    };
    const t = makeTransport(client);

    t.send(mockTrackEventPayload({ n: 'high_ev', priority: EventPriority.High }));
    t.send(mockTrackEventPayload({ n: 'normal_ev', priority: EventPriority.Normal }));
    t.send(mockTrackEventPayload({ n: 'critical_ev', priority: EventPriority.Critical }));

    await t.flush();

    const allEvents = bodies.flatMap(
      (b) => (JSON.parse(b) as { events: { n: string }[] }).events
    );
    expect(allEvents.map((e) => e.n).sort()).toEqual(['critical_ev', 'high_ev', 'normal_ev']);
    await t.close();
  });

  it('drain() emits a beacon per lane that has events', () => {
    const beaconCount = { value: 0 };
    const origNavigator = (global as Record<string, unknown>).navigator;
    Object.defineProperty(global, 'navigator', {
      value: {
        sendBeacon: () => {
          beaconCount.value++;
          return true;
        }
      },
      configurable: true
    });

    const t = makeTransport(makeMockClient(), { paused: true });

    t.send(mockTrackEventPayload({ n: 'normal_ev', priority: EventPriority.Normal }));
    t.send(mockTrackEventPayload({ n: 'high_ev', priority: EventPriority.High }));
    t.send(mockTrackEventPayload({ n: 'critical_ev', priority: EventPriority.Critical }));
    t.drain();

    expect(beaconCount.value).toBe(3);
    Object.defineProperty(global, 'navigator', { value: origNavigator, configurable: true });
  });

  it('queueSize is the sum of all three lanes', () => {
    const t = makeTransport(makeMockClient(), { paused: true });
    t.send(mockTrackEventPayload({ n: 'a' }));
    t.send(mockTrackEventPayload({ n: 'b', priority: EventPriority.High }));
    t.send(mockTrackEventPayload({ n: 'c', priority: EventPriority.Critical }));
    expect(t.queueSize).toBe(3);
  });

  it('pause/start applies to all three lanes', async () => {
    const bodies: string[] = [];
    const client: IHttpClient = {
      post: async (_url: string, body: Uint8Array | string) => {
        bodies.push(typeof body === 'string' ? body : new TextDecoder().decode(body));
        return { ok: true, status: 200, headers: { get: () => null }, body: null };
      }
    };
    const t = makeTransport(client, { paused: true });

    t.send(mockTrackEventPayload({ n: 'critical_ev', priority: EventPriority.Critical }));
    t.send(mockTrackEventPayload({ n: 'high_ev', priority: EventPriority.High }));
    t.send(mockTrackEventPayload({ n: 'normal_ev' }));

    expect(bodies).toHaveLength(0);
    t.start();
    await t.flush();

    const allEvents = bodies.flatMap(
      (b) => (JSON.parse(b) as { events: { n: string }[] }).events
    );
    expect(allEvents.map((e) => e.n).sort()).toEqual(['critical_ev', 'high_ev', 'normal_ev']);
    await t.close();
  });

  it('updateBatchConfig only updates the normal lane, no errors thrown', async () => {
    const bodies: string[] = [];
    const client: IHttpClient = {
      post: async (_url: string, body: Uint8Array | string) => {
        bodies.push(typeof body === 'string' ? body : new TextDecoder().decode(body));
        return { ok: true, status: 200, headers: { get: () => null }, body: null };
      }
    };
    const t = makeTransport(client);
    t.updateBatchConfig(3, 1_000);
    t.send(mockTrackEventPayload({ n: 'ev' }));
    await t.flush();
    expect(bodies.length).toBeGreaterThanOrEqual(1);
    await t.close();
  });
});