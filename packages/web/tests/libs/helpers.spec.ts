/** @jest-environment jsdom */

import { Consent, ConsentStatus, IConsent } from '@wince/consent';
import Transport, { DEFAULT_TRANSPORT_OPTIONS } from '@wince/transport';
import { DropReason, IStorage, TrackEventPayload } from '@wince/types';
import { WINDOW_ID_KEY, getOrCreateWindowId } from '../../src/lib/_windowId.js';
import { BaseClient } from '../../src/lib/baseClient.js';
import { wireConsent } from '../../src/lib/consentWire.js';
import { buildBaseDiagnostics } from '../../src/lib/diagnostics.js';
import { fetchEnrichment } from '../../src/lib/enrichment.js';
import { applyEnrichmentOnceToEvents } from '../../src/lib/preEnrich.js';
import { StoreKind } from '@wince/types';
function makeResponse(ok: boolean, body: unknown): Response {
  return {
    ok,
    json: async () => body
  } as unknown as Response;
}

function createStorageMock(): IStorage {
  const data = new Map<string, string>();

  return {
    isAvailable: () => true,
    getStrategy: () => 'cookie' as StoreKind,
    get length() {
      return data.size;
    },
    clear: () => {
      data.clear();
    },
    get: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    delete: (key: string) => {
      data.delete(key);
    },
    set: (key: string, value: string) => {
      data.set(key, value);
    },
    refreshKey: () => undefined,
    flush: () => undefined
  } as IStorage;
}

function makeTransportMock() {
  return {
    start: jest.fn(),
    pause: jest.fn(),
    flush: jest.fn(),
    close: jest.fn(),
    send: jest.fn(),
    drain: jest.fn(),
    queueSize: 0,
    circuitOpen: false
  } as unknown as Transport<TrackEventPayload>;
}

class TestClient extends BaseClient {
  constructor(config: ConstructorParameters<typeof BaseClient>[0], _consent?: IConsent) {
    super(config, _consent);
    this._transport = makeTransportMock();
  }

  diagnostics(): unknown {
    return {};
  }

  maybeStart(): void {
    this._maybeStart();
  }

  drop(reason: DropReason): void {
    this._drop(reason);
  }

  get transportMock() {
    return this._transport as unknown as ReturnType<typeof makeTransportMock>;
  }
}

describe('buildBaseDiagnostics', () => {
  it('returns a snapshot with summed drop counts and queue state', async () => {
    const idbQueueSize = Promise.resolve(12);
    const transport = {
      queueSize: 4,
      circuitOpen: true
    } as unknown as Transport<TrackEventPayload>;

    const result = buildBaseDiagnostics(
      { sent: 9, droppedByReason: { consent: 2, sampling: undefined } },
      transport,
      idbQueueSize
    );

    await expect(result.idbQueueSize).resolves.toBe(12);
    expect(result.eventsQueued).toBe(4);
    expect(result.eventsSent).toBe(9);
    expect(result.eventsDropped).toBe(2);
    expect(result.droppedByReason).toEqual({ consent: 2, sampling: undefined });
    expect(result.circuitOpen).toBe(true);
  });
});

describe('applyEnrichmentOnceToEvents', () => {
  it('applies enrichment only to the first non-identify event', () => {
    const events: TrackEventPayload[] = [
      {
        n: '$identify',
        eid: '1',
        seq: 0,
        ts: 1,
        sid: 'sid',
        anon: 'anon',
        props: { keep: true },
        priority: 1
      },
      {
        n: '$page_view',
        eid: '2',
        seq: 1,
        ts: 2,
        sid: 'sid',
        anon: 'anon',
        props: { existing: true },
        $set: { tier: 'gold' },
        $set_once: { first_seen: 'event' },
        priority: 2
      },
      { n: '$click', eid: '3', seq: 2, ts: 3, sid: 'sid', anon: 'anon', priority: 0 }
    ];

    const result = applyEnrichmentOnceToEvents(
      events,
      { utm_source: 'newsletter' },
      { $set: { country: 'US' }, $set_once: { first_seen: 'enrichment' } }
    );

    expect(result.applied).toBe(true);
    expect(result.events[0]).toBe(events[0]);
    expect(result.events[1]).toEqual({
      ...events[1],
      props: { utm_source: 'newsletter', existing: true },
      $set: { country: 'US', tier: 'gold' },
      $set_once: { first_seen: 'event' }
    });
    expect(result.events[2]).toBe(events[2]);
  });

  it('returns the original events when no enrichment is provided', () => {
    const events: TrackEventPayload[] = [
      { n: '$click', eid: '1', seq: 0, ts: 1, sid: 'sid', anon: 'anon', priority: 0 }
    ];

    const result = applyEnrichmentOnceToEvents(events);

    expect(result.applied).toBe(false);
    expect(result.events).toEqual(events);
  });
});

describe('wireConsent', () => {
 
  it('routes status changes to the expected handlers', () => {
    let listener: ((status: ConsentStatus) => void) | undefined;
    const unsubscribe = jest.fn();
    const consent = {
      onChange: jest.fn((cb: (status: ConsentStatus) => void) => {
        listener = cb;
        return unsubscribe;
      })
    };
    const handlers = {
      onGrant: jest.fn(),
      onRevoke: jest.fn(),
      onMigrate: jest.fn()
    };

    const result = wireConsent(consent as never, 'on_reject', handlers);
    expect(result).toBe(unsubscribe);

    listener?.(ConsentStatus.GRANTED);
    listener?.(ConsentStatus.DENIED);

    expect(handlers.onMigrate).toHaveBeenCalledTimes(1);
    expect(handlers.onGrant).toHaveBeenCalledTimes(1);
    expect(handlers.onRevoke).toHaveBeenCalledTimes(1);
  });

  it('does not migrate when cookieless is off', () => {
    let listener: ((status: ConsentStatus) => void) | undefined;
    const consent: IConsent = {
      onChange: jest.fn((cb: (status: ConsentStatus) => void) => {
        listener = cb;
        return () => undefined;
      }),
      getStatus: function (): ConsentStatus {
        throw new Error('Function not implemented.');
      },
      isGranted: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isDenied: function (): boolean {
        throw new Error('Function not implemented.');
      },
      isPending: function (): boolean {
        throw new Error('Function not implemented.');
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
    const handlers = {
      onGrant: jest.fn(),
      onRevoke: jest.fn(),
      onMigrate: jest.fn()
    };

    wireConsent(consent , 'off', handlers);
    listener?.(ConsentStatus.GRANTED);

    expect(handlers.onMigrate).not.toHaveBeenCalled();
    expect(handlers.onGrant).toHaveBeenCalledTimes(1);
  });
});

describe('fetchEnrichment', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('parses uid, props, and person props from a successful response', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      makeResponse(true, {
        uid: 'user-1',
        $set: { plan: 'pro' },
        $set_once: { source: 'ad' },
        utm_source: 'newsletter'
      })
    );

    const result = await fetchEnrichment(
      'https://example.test/enrich',
      () => 'anon-1',
      () => 'session-1',
      fetchFn
    );

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toContain('anon=anon-1');
    expect(fetchFn.mock.calls[0][0]).toContain('session=session-1');
    expect(result).toEqual({
      uid: 'user-1',
      props: { utm_source: 'newsletter' },
      personProps: {
        $set: { plan: 'pro' },
        $set_once: { source: 'ad' }
      }
    });
  });

  it('returns undefined for non-ok responses, malformed bodies, and fetch failures', async () => {
    const nonOk = await fetchEnrichment(
      'https://example.test/enrich',
      () => 'anon',
      () => 'session',
      jest.fn().mockResolvedValue(makeResponse(false, { ok: false }))
    );
    const malformed = await fetchEnrichment(
      'https://example.test/enrich',
      () => 'anon',
      () => 'session',
      jest.fn().mockResolvedValue(makeResponse(true, 42))
    );
    const failed = await fetchEnrichment(
      'https://example.test/enrich',
      () => 'anon',
      () => 'session',
      jest.fn().mockRejectedValue(new Error('network failed'))
    );

    expect(nonOk).toBeUndefined();
    expect(malformed).toBeUndefined();
    expect(failed).toBeUndefined();
  });
});

describe('window id helper', () => {
  let originalSessionStorage: Storage | undefined;

  beforeEach(() => {
    originalSessionStorage = (globalThis as Record<string, unknown>).sessionStorage as
      | Storage
      | undefined;
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: createStorageMock(),
      configurable: true
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: originalSessionStorage,
      configurable: true
    });
    originalSessionStorage = undefined;
  });

  it('reuses the stored window id when present', () => {
    sessionStorage.setItem(WINDOW_ID_KEY, 'stored-window-id');
    expect(getOrCreateWindowId()).toBe('stored-window-id');
  });

  it('stores a generated id when none is present', () => {
    const id = getOrCreateWindowId();

    expect(id).toBe(sessionStorage.getItem(WINDOW_ID_KEY));
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('falls back when sessionStorage throws', () => {
    const getItemSpy = jest.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(getOrCreateWindowId()).toMatch(/^[0-9a-f-]{36}$/);
    getItemSpy.mockRestore();
  });
});

describe('BaseClient', () => {
  it('starts and pauses the transport when consent is disabled', () => {
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
    const client = new TestClient({
      transportOptions: DEFAULT_TRANSPORT_OPTIONS,
      consentOptions: {
        ignoreDnt: true
      }
    } , mockConsent);
    client.maybeStart();

    expect(client.transportMock.start).toHaveBeenCalledTimes(1);

    client.optOut();
    expect(client.transportMock.pause).toHaveBeenCalledTimes(1);

    client.optIn();
    expect(client.transportMock.start).toHaveBeenCalledTimes(2);
  });



  it('delegates optIn and optOut to Consent instances', () => {
    const storageMock = createStorageMock();
    const consent = new Consent(
      {
        ignoreDnt: true
      },
      storageMock
    );
    const optInSpy = jest.spyOn(consent, 'optIn');
    const optOutSpy = jest.spyOn(consent, 'optOut');
    const client = new TestClient({ transportOptions: DEFAULT_TRANSPORT_OPTIONS, consentOptions: { ignoreDnt: true } }, consent);

    client.optIn();
    client.optOut();

    expect(optInSpy).toHaveBeenCalledTimes(1);
    expect(optOutSpy).toHaveBeenCalledTimes(1);
    expect(client.transportMock.start).not.toHaveBeenCalled();
    expect(client.transportMock.pause).not.toHaveBeenCalled();
  });

  it('records drop counters', () => {
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
    const client = new TestClient({ transportOptions: DEFAULT_TRANSPORT_OPTIONS, consentOptions: { ignoreDnt: true } }, mockConsent);

    client.drop('consent');
    client.drop('consent');

    expect(
      (
        client as unknown as {
          _diag: { droppedByReason: Record<string, number> };
        }
      )._diag.droppedByReason.consent
    ).toBe(2);
  });
});
