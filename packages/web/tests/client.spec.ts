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
  return new WinceClient(
    {
      endpoint: 'https://ingest.test/events',
      transportOptions: DEFAULT_TRANSPORT_OPTIONS,
      consentOptions: {},

      // consent: null, // disable consent gating by default
      // compress: false, // keep bodies as JSON strings for easy inspection
      // batchSize: 50,
      // batchTimeoutMs: 100,
      fetch: makeFetch(),
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
