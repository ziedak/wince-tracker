import { TrackEventPayload } from '@wince/types';
import { WinceConfig, WinceClient } from '../src/client.js';
import { ConsentStatus, IConsent } from '@wince/consent';
import { DEFAULT_TRANSPORT_OPTIONS } from '@wince/transport';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeFetch(status = 200) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    body: null
  } as unknown as Response);
}

/** Create a client with consent disabled and compression off (for readable request bodies). */
function makeClient(overrides: Partial<WinceConfig> = {}, _consent: IConsent) {
  const fetchFn = overrides.fetch ?? makeFetch();
  // The transport uses the global fetch via HttpClient, so we mock it here.
  (globalThis as Record<string, unknown>).fetch = fetchFn;

  const useCompression = overrides.compress ?? false;
  // Override compressFn to passthrough when compression is disabled
  // so request bodies remain JSON strings for easy inspection.
  const passthrough = async (input: string | ArrayBuffer | Uint8Array) =>
    input as unknown as Uint8Array;
  const transportOptions = {
    ...DEFAULT_TRANSPORT_OPTIONS,
    url: overrides.endpoint ?? 'https://ingest.test/events',
    compress: { enabled: useCompression },
    paused: true,
    exporterOpts: {
      critical: {
        ...DEFAULT_TRANSPORT_OPTIONS.exporterOpts.critical,
        compressFn: useCompression ? DEFAULT_TRANSPORT_OPTIONS.exporterOpts.critical.compressFn : passthrough,
      },
      high: {
        ...DEFAULT_TRANSPORT_OPTIONS.exporterOpts.high,
        compressFn: useCompression ? DEFAULT_TRANSPORT_OPTIONS.exporterOpts.high.compressFn : passthrough,
      },
      normal: {
        ...DEFAULT_TRANSPORT_OPTIONS.exporterOpts.normal,
        compressFn: useCompression ? DEFAULT_TRANSPORT_OPTIONS.exporterOpts.normal.compressFn : passthrough,
      },
    },
  };

  return new WinceClient(
    {
      endpoint: 'https://ingest.test/events',
      transportOptions,
      consentOptions: {},
      fetch: fetchFn,
      ...overrides
    },
    _consent
  );
}

/** Grab the first parsed batch sent to fetchFn. */
async function getFirstBatch(client: WinceClient, fetchFn: jest.Mock) {
  await client.flush();
  expect(fetchFn).toHaveBeenCalled();
  const envelope = JSON.parse(fetchFn.mock.calls[0][1].body as string) as {
    events: TrackEventPayload[];
  };
  return envelope.events;
}

// ---------------------------------------------------------------------------
// page()
// ---------------------------------------------------------------------------

describe('WinceClient — page()', () => {
  it('emits a $page_view event', async () => {
    const fetchFn = makeFetch();
    const mockConsent: IConsent = {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: function (): ConsentStatus {
        throw new Error('Function not implemented.');
      },
      isDenied: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isPending: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient({ fetch: fetchFn }, mockConsent);
    client.page();
    const [ev] = await getFirstBatch(client, fetchFn);
    expect(ev.n).toBe('$page_view');
    await client.close();
  });

  it('merges caller props into the page view event', async () => {
    const fetchFn = makeFetch();
    const mockConsent: IConsent = {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: function (): ConsentStatus {
        throw new Error('Function not implemented.');
      },
      isDenied: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isPending: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient({ fetch: fetchFn }, mockConsent);
    client.page({ section: 'checkout' });
    const [ev] = await getFirstBatch(client, fetchFn);
    expect(ev.n).toBe('$page_view');
    expect((ev.props as Record<string, unknown>)?.section).toBe('checkout');
    await client.close();
  });

  it('increments seq like any other event', async () => {
    const fetchFn = makeFetch();
    const mockConsent: IConsent = {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: function (): ConsentStatus {
        throw new Error('Function not implemented.');
      },
      isDenied: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isPending: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient({ fetch: fetchFn }, mockConsent);
    client.track('first');
    client.page();
    const batch = await getFirstBatch(client, fetchFn);
    expect(batch[1].seq).toBe(1);
    await client.close();
  });
});

// ---------------------------------------------------------------------------
// Enrichment — non-blocking fire-and-forget
// ---------------------------------------------------------------------------

describe('WinceClient — enrichment', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  function mockGrantedConsent(): IConsent {
    return {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: () => ConsentStatus.GRANTED,
      isDenied: () => false,
      isPending: () => false,
    };
  }

  it('fires enrichment GET on init and identifies user when uid is returned', async () => {
    const fetchFn = jest.fn().mockImplementation((url: string) => {
      if (url.includes('enrich')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          body: null,
          json: async () => ({ uid: 'enriched-user-123', $set: { tier: 'gold' } }),
        } as unknown as Response);
      }
      // Transport fetch
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: null,
      } as unknown as Response);
    });
    (globalThis as Record<string, unknown>).fetch = fetchFn;

    const client = makeClient(
      {
        fetch: fetchFn,
        enrichmentUrl: 'https://enrich.test/enrich',
        enrichmentTimeoutMs: 500,
      },
      mockGrantedConsent(),
    );

    // Track an event immediately (before enrichment resolves)
    client.track('before_enrich');

    // Wait for enrichment to resolve
    await new Promise((r) => setTimeout(r, 100));

    // Track another event after enrichment
    client.track('after_enrich');
    await client.flush();

    // The enrichment GET should have been called
    const enrichCall = fetchFn.mock.calls.find((c: unknown[]) => (c[0] as string).includes('enrich'));
    expect(enrichCall).toBeDefined();

    // The "after_enrich" event should carry the enriched uid
    const transportCall = fetchFn.mock.calls.find(
      (c: unknown[]) => !(c[0] as string).includes('enrich'),
    );
    expect(transportCall).toBeDefined();
    const envelope = JSON.parse(transportCall![1].body as string) as {
      events: TrackEventPayload[];
    };
    const afterEvent = envelope.events.find((e) => e.n === 'after_enrich');
    expect(afterEvent).toBeDefined();
    expect(afterEvent!.uid).toBe('enriched-user-123');

    await client.close();
  });

  it('does not block transport when enrichmentUrl is set', async () => {
    // Use a never-resolving enrichment to guarantee it doesn't block
    const neverResolve = new Promise(() => {});
    const fetchFn = jest.fn().mockImplementation((url: string) => {
      if (url.includes('enrich')) {
        return neverResolve as unknown as Promise<Response>;
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: null,
      } as unknown as Response);
    });
    (globalThis as Record<string, unknown>).fetch = fetchFn;

    const client = makeClient(
      {
        fetch: fetchFn,
        enrichmentUrl: 'https://enrich.test/never',
        enrichmentTimeoutMs: 60_000,
      },
      mockGrantedConsent(),
    );

    // Track immediately — should be sent without waiting for enrichment
    client.track('immediate');
    await client.flush();

    // Transport fetch should have been called even though enrichment hasn't resolved
    const transportCall = fetchFn.mock.calls.find(
      (c: unknown[]) => !(c[0] as string).includes('enrich'),
    );
    expect(transportCall).toBeDefined();

    const envelope = JSON.parse(transportCall![1].body as string) as {
      events: TrackEventPayload[];
    };
    expect(envelope.events).toHaveLength(1);
    expect(envelope.events[0].n).toBe('immediate');
    // uid should NOT be set (enrichment never resolved)
    expect(envelope.events[0].uid).toBeUndefined();

    await client.close();
  });

  it('handles enrichment failure gracefully', async () => {
    // Enrichment returns 500 — fetchEnrichment returns undefined (no uid)
    const fetchFn = jest.fn().mockImplementation((url: string) => {
      if (url.includes('enrich')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          headers: { get: () => null },
          body: null,
          json: async () => ({}),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: null,
      } as unknown as Response);
    });
    (globalThis as Record<string, unknown>).fetch = fetchFn;

    const client = makeClient(
      {
        fetch: fetchFn,
        enrichmentUrl: 'https://enrich.test/fail',
        enrichmentTimeoutMs: 500,
      },
      mockGrantedConsent(),
    );

    // Wait for enrichment to resolve (it returns ok:false → no identify)
    await new Promise((r) => setTimeout(r, 150));

    client.track('ev');
    await client.flush();

    const transportCall = fetchFn.mock.calls.find(
      (c: unknown[]) => !(c[0] as string).includes('enrich'),
    );
    expect(transportCall).toBeDefined();
    const envelope = JSON.parse(transportCall![1].body as string) as {
      events: TrackEventPayload[];
    };
    // No uid — enrichment failed
    expect(envelope.events[0].uid).toBeUndefined();

    await client.close();
  });
});

// ---------------------------------------------------------------------------
// handleServerIdentify — server-pushed identification via WS
// ---------------------------------------------------------------------------

describe('WinceClient — handleServerIdentify', () => {
  function mockGrantedConsent(): IConsent {
    return {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: () => ConsentStatus.GRANTED,
      isDenied: () => false,
      isPending: () => false,
    };
  }

  it('identifies user and stamps uid on subsequent events', async () => {
    const fetchFn = makeFetch();
    (globalThis as Record<string, unknown>).fetch = fetchFn;
    const client = makeClient({ fetch: fetchFn }, mockGrantedConsent());

    // Before identify — no uid
    client.track('before');
    await client.flush();
    fetchFn.mockClear();

    // Server pushes identify
    client.handleServerIdentify('server-user-456', { $set: { plan: 'pro' } });

    // After identify — uid should be set on subsequent events
    client.track('after');
    await client.flush();

    const envelope = JSON.parse(fetchFn.mock.calls[0][1].body as string) as {
      events: TrackEventPayload[];
    };
    // The $identify event carries $set
    const identifyEvent = envelope.events.find((e) => e.n === '$identify');
    expect(identifyEvent).toBeDefined();
    expect(identifyEvent!.uid).toBe('server-user-456');
    expect(identifyEvent!.$set).toEqual({ plan: 'pro' });

    // The regular event carries uid but not $set
    const afterEvent = envelope.events.find((e) => e.n === 'after');
    expect(afterEvent).toBeDefined();
    expect(afterEvent!.uid).toBe('server-user-456');

    await client.close();
  });

  it('later identify overwrites previous identity', async () => {
    const fetchFn = makeFetch();
    (globalThis as Record<string, unknown>).fetch = fetchFn;
    const client = makeClient({ fetch: fetchFn }, mockGrantedConsent());

    client.handleServerIdentify('user-a');
    client.track('event_a');
    await client.flush();
    fetchFn.mockClear();

    // Server pushes a new identify — overwrites
    client.handleServerIdentify('user-b');
    client.track('event_b');
    await client.flush();

    const envelope = JSON.parse(fetchFn.mock.calls[0][1].body as string) as {
      events: TrackEventPayload[];
    };
    const eventB = envelope.events.find((e) => e.n === 'event_b');
    expect(eventB).toBeDefined();
    expect(eventB!.uid).toBe('user-b');

    await client.close();
  });

  it('emits a $identify event when traits are provided', async () => {
    const fetchFn = makeFetch();
    (globalThis as Record<string, unknown>).fetch = fetchFn;
    const client = makeClient({ fetch: fetchFn }, mockGrantedConsent());

    client.handleServerIdentify('user-x', { $set: { tier: 'premium' } });
    await client.flush();

    const envelope = JSON.parse(fetchFn.mock.calls[0][1].body as string) as {
      events: TrackEventPayload[];
    };
    const identifyEvent = envelope.events.find((e) => e.n === '$identify');
    expect(identifyEvent).toBeDefined();
    expect(identifyEvent!.uid).toBe('user-x');
    expect(identifyEvent!.$set).toEqual({ tier: 'premium' });

    await client.close();
  });
});

// ---------------------------------------------------------------------------
// track()
// ---------------------------------------------------------------------------

describe('WinceClient — track()', () => {
  it('queues an event that is sent on flush()', async () => {
    const fetchFn = makeFetch();
    const mockConsent: IConsent = {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: function (): ConsentStatus {
        throw new Error('Function not implemented.');
      },
      isDenied: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isPending: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient({ fetch: fetchFn }, mockConsent);
    client.track('page_view');
    const batch = await getFirstBatch(client, fetchFn);
    expect(batch).toHaveLength(1);
    expect(batch[0].n).toBe('page_view');
    await client.close();
  });

  it('enriches events with required fields', async () => {
    const fetchFn = makeFetch();
    const mockConsent: IConsent = {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: function (): ConsentStatus {
        throw new Error('Function not implemented.');
      },
      isDenied: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isPending: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient({ fetch: fetchFn }, mockConsent);
    client.track('click', { target: 'btn' });
    const [ev] = await getFirstBatch(client, fetchFn);

    expect(ev.eid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(ev.seq).toBe(0);
    expect(typeof ev.ts).toBe('number');
    expect(ev.sid).toMatch(/^[0-9a-f-]{36}$/);
    expect(ev.anon).toMatch(/^[0-9a-f-]{36}$/);
    expect(ev.props).toEqual({ target: 'btn' });
    await client.close();
  });

  it('increments seq on each event', async () => {
    const fetchFn = makeFetch();
    const mockConsent: IConsent = {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: function (): ConsentStatus {
        throw new Error('Function not implemented.');
      },
      isDenied: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isPending: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient({ fetch: fetchFn }, mockConsent);
    client.track('a');
    client.track('b');
    client.track('c');
    const batch = await getFirstBatch(client, fetchFn);
    expect(batch.map((e) => e.seq)).toEqual([0, 1, 2]);
    await client.close();
  });

  it('same session ID across consecutive events', async () => {
    const fetchFn = makeFetch();
    const mockConsent: IConsent = {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: function (): ConsentStatus {
        throw new Error('Function not implemented.');
      },
      isDenied: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isPending: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient({ fetch: fetchFn }, mockConsent);
    client.track('a');
    client.track('b');
    const batch = await getFirstBatch(client, fetchFn);
    expect(batch[0].sid).toBe(batch[1].sid);
    await client.close();
  });

  it('beforeTrack can drop an event', async () => {
    const fetchFn = makeFetch();
    const mockConsent: IConsent = {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: function (): ConsentStatus {
        throw new Error('Function not implemented.');
      },
      isDenied: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isPending: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient(
      {
        fetch: fetchFn,
        beforeTrack: (e: TrackEventPayload) => (e.n === 'drop_me' ? null : e)
      },
      mockConsent
    );
    client.track('keep');
    client.track('drop_me');
    const batch = await getFirstBatch(client, fetchFn);
    expect(batch).toHaveLength(1);
    expect(batch[0].n).toBe('keep');
    await client.close();
  });

  it('beforeTrack can enrich the event', async () => {
    const fetchFn = makeFetch();
    const mockConsent: IConsent = {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: function (): ConsentStatus {
        throw new Error('Function not implemented.');
      },
      isDenied: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isPending: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient(
      {
        fetch: fetchFn,
        beforeTrack: (e: TrackEventPayload) => ({ ...e, props: { ...e.props, extra: 42 } })
      },
      mockConsent
    );
    client.track('ev', { original: true });
    const [ev] = await getFirstBatch(client, fetchFn);
    expect(ev.props).toEqual({ original: true, extra: 42 });
    await client.close();
  });
});

// ---------------------------------------------------------------------------
// identify() / reset()
// ---------------------------------------------------------------------------

describe('WinceClient — identify() / reset()', () => {
  it('identify() adds uid to subsequent events', async () => {
    const fetchFn = makeFetch();
    const mockConsent: IConsent = {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: function (): ConsentStatus {
        throw new Error('Function not implemented.');
      },
      isDenied: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isPending: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient({ fetch: fetchFn }, mockConsent);
    client.identify('user-001');
    client.track('ev');
    const [ev] = await getFirstBatch(client, fetchFn);
    expect(ev.uid).toBe('user-001');
    await client.close();
  });

  it('reset() changes the anonymous ID', async () => {
    const fetchFn = makeFetch();
    const mockConsent: IConsent = {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: function (): ConsentStatus {
        throw new Error('Function not implemented.');
      },
      isDenied: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isPending: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient({ fetch: fetchFn }, mockConsent);
    client.track('before');
    const [before] = await getFirstBatch(client, fetchFn);
    const anonBefore = before.anon;

    fetchFn.mockClear();
    client.reset();
    client.track('after');
    const [after] = await getFirstBatch(client, fetchFn);

    expect(after.anon).not.toBe(anonBefore);
    await client.close();
  });

  it('reset() clears userId', async () => {
    const fetchFn = makeFetch();
    const mockConsent: IConsent = {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: function (): ConsentStatus {
        throw new Error('Function not implemented.');
      },
      isDenied: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isPending: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient({ fetch: fetchFn }, mockConsent);
    client.identify('u1');
    client.reset();
    client.track('ev');
    const [ev] = await getFirstBatch(client, fetchFn);
    expect(ev.uid).toBeUndefined();
    await client.close();
  });

  it('reset() resets seq back to 0', async () => {
    const fetchFn = makeFetch();
    const mockConsent: IConsent = {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: function (): ConsentStatus {
        throw new Error('Function not implemented.');
      },
      isDenied: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isPending: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient({ fetch: fetchFn }, mockConsent);
    client.track('a');
    client.track('b');
    await client.flush();
    fetchFn.mockClear();

    client.reset();
    client.track('c');
    const [ev] = await getFirstBatch(client, fetchFn);
    expect(ev.seq).toBe(0);
    await client.close();
  });
});

// ---------------------------------------------------------------------------
// Consent gating
// ---------------------------------------------------------------------------

describe('WinceClient — consent gating', () => {
  it('track() is a no-op when consent is PENDING', async () => {
    const fetchFn = makeFetch();
    const noopUnsubscribe = () => undefined;
    const mockConsent: IConsent = {
      getStatus: () => -1 as const,
      isGranted: () => false,
      isDenied: () => false,
      isPending: () => true,
      onChange: () => noopUnsubscribe,
      optIn: function (): void {
        throw new Error('Function not implemented.');
      },
      optOut: function (): void {
        throw new Error('Function not implemented.');
      },
      clear: function (): void {
        throw new Error('Function not implemented.');
      },
      isDntActive: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient({ fetch: fetchFn }, mockConsent);
    client.track('ev');
    await client.flush();
    expect(fetchFn).not.toHaveBeenCalled();
    await client.close();
  });

  it('transport resumes after consent onChange, and events track after that', async () => {
    const fetchFn = makeFetch();
    let consentStatus = -1; // starts PENDING
    let consentCb: ((s: -1 | 0 | 1) => void) | undefined;
    const noopUnsubscribe = () => undefined;
    const mockConsent: IConsent = {
      getStatus: () => consentStatus as -1 | 0 | 1,
      isGranted: () => consentStatus === 1,
      isDenied: () => consentStatus === 0,
      isPending: () => consentStatus === -1,
      onChange: (cb: (s: -1 | 0 | 1) => void) => {
        consentCb = cb;
        return noopUnsubscribe;
      },
      optIn: function (): void {
        throw new Error('Function not implemented.');
      },
      optOut: function (): void {
        throw new Error('Function not implemented.');
      },
      clear: function (): void {
        throw new Error('Function not implemented.');
      },
      isDntActive: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient({ fetch: fetchFn }, mockConsent);

    // Events before consent are not tracked (GDPR: no data without consent)
    client.track('before_consent');
    await client.flush();
    expect(fetchFn).not.toHaveBeenCalled();

    // Grant consent — transport resumes, subsequent events are tracked
    consentStatus = 1;
    consentCb!(1);
    client.track('after_consent');
    const batch = await getFirstBatch(client, fetchFn);
    expect(batch[0].n).toBe('after_consent');
    await client.close();
  });
});

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

describe('WinceClient — sampling', () => {
  it('sampleRate=0 drops all events', async () => {
    const fetchFn = makeFetch();
    const mockConsent: IConsent = {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: function (): ConsentStatus {
        throw new Error('Function not implemented.');
      },
      isDenied: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isPending: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient({ fetch: fetchFn, sampleRate: 0 }, mockConsent);
    client.track('ev1');
    client.track('ev2');
    await client.flush();
    expect(fetchFn).not.toHaveBeenCalled();
    await client.close();
  });

  it('sampleRate=1 keeps all events', async () => {
    const fetchFn = makeFetch();
    const mockConsent: IConsent = {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: function (): ConsentStatus {
        throw new Error('Function not implemented.');
      },
      isDenied: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isPending: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient({ fetch: fetchFn, sampleRate: 1 }, mockConsent);
    client.track('ev');
    const batch = await getFirstBatch(client, fetchFn);
    expect(batch).toHaveLength(1);
    await client.close();
  });
});

// ---------------------------------------------------------------------------
// Browser lifecycle (requires jsdom)
// ---------------------------------------------------------------------------

describe('WinceClient — browser lifecycle', () => {
  it('pagehide event calls transport.drain()', () => {
    const beaconCalls: string[] = [];
    // Inject sendBeacon into jsdom's navigator
    Object.defineProperty(navigator, 'sendBeacon', {
      value: (url: string) => {
        beaconCalls.push(url);
        return true;
      },
      configurable: true
    });

    const fetchFn = makeFetch();
    const mockConsent: IConsent = {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: function (): ConsentStatus {
        throw new Error('Function not implemented.');
      },
      isDenied: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isPending: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient({ fetch: fetchFn }, mockConsent);
    client.track('ev');

    window.dispatchEvent(new Event('pagehide'));

    expect(beaconCalls).toHaveLength(1);
    expect(beaconCalls[0]).toBe('https://ingest.test/events');

    // Clean up
    Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true });
  });

  it('offline event pauses transport, online resumes it', async () => {
    const fetchFn = makeFetch();
    const mockConsent: IConsent = {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: function (): ConsentStatus {
        throw new Error('Function not implemented.');
      },
      isDenied: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isPending: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient({ fetch: fetchFn }, mockConsent);

    window.dispatchEvent(new Event('offline'));
    client.track('buffered');
    // Advance timers — auto-flush should not fire while paused
    await Promise.resolve();
    expect(fetchFn).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('online'));
    await client.flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await client.close();
  });

  it('close() removes lifecycle listeners', async () => {
    const fetchFn = makeFetch();
    const mockConsent: IConsent = {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: function (): ConsentStatus {
        throw new Error('Function not implemented.');
      },
      isDenied: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isPending: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient({ fetch: fetchFn }, mockConsent);
    await client.close();

    // After close, pagehide should not trigger drain (no error either)
    expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Compression
// ---------------------------------------------------------------------------

describe('WinceClient — compression', () => {
  it('compress:true sends a Uint8Array body instead of a plain JSON string', async () => {
    const fetchFn = makeFetch();
    const mockConsent: IConsent = {
      isGranted: () => true,
      onChange: () => () => {},
      optIn: () => {},
      optOut: () => {},
      clear: () => {},
      isDntActive: () => false,
      getStatus: function (): ConsentStatus {
        throw new Error('Function not implemented.');
      },
      isDenied: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isPending: function (): boolean {
        throw new Error('Function not implemented.');
      }
    };
    const client = makeClient({ fetch: fetchFn, compress: true }, mockConsent);

    client.track('ev');
    await client.flush();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const body = fetchFn.mock.calls[0][1].body;
    expect(body).toBeInstanceOf(Uint8Array);

    await client.close();
  });
});
