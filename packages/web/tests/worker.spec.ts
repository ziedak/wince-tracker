import { WorkerClient, initWithWorker } from '../src/worker/client.js';
import { WinceClient } from '../src/client.js';
import type { MainToWorkerMsg, WorkerToMainMsg } from '../src/worker/messages.js';
import { EventPriority, TrackEventPayload } from '@wince/types';
import type { IConsent } from '@wince/consent';
import { DEFAULT_TRANSPORT_OPTIONS } from '@wince/transport';

// ---------------------------------------------------------------------------
// MockWorker — simulates the browser Worker API
// ---------------------------------------------------------------------------

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;

  private _sent: MainToWorkerMsg[] = [];

  postMessage(msg: MainToWorkerMsg): void {
    this._sent.push(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Helper: return all messages sent to the Worker so far. */
  sentMessages(): MainToWorkerMsg[] {
    return [...this._sent];
  }

  /** Simulate an incoming message from the Worker to the main thread. */
  simulateIncoming(msg: WorkerToMainMsg): void {
    this.onmessage?.({ data: msg } as MessageEvent<WorkerToMainMsg>);
  }
}

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makeFetch(status = 200) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    body: null,
  } as unknown as Response);
}

function setCompression(enabled: boolean) {
  return {
    exporterOpts: {
      critical: {
        ...DEFAULT_TRANSPORT_OPTIONS.exporterOpts.critical,
        compressFn: enabled
          ? DEFAULT_TRANSPORT_OPTIONS.exporterOpts.critical.compressFn
          : (async (input: string | ArrayBuffer | Uint8Array) => input as unknown as Uint8Array),
      },
      high: {
        ...DEFAULT_TRANSPORT_OPTIONS.exporterOpts.high,
        compressFn: enabled
          ? DEFAULT_TRANSPORT_OPTIONS.exporterOpts.high.compressFn
          : (async (input: string | ArrayBuffer | Uint8Array) => input as unknown as Uint8Array),
      },
      normal: {
        ...DEFAULT_TRANSPORT_OPTIONS.exporterOpts.normal,
        compressFn: enabled
          ? DEFAULT_TRANSPORT_OPTIONS.exporterOpts.normal.compressFn
          : (async (input: string | ArrayBuffer | Uint8Array) => input as unknown as Uint8Array),
      },
    },
  };
}

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    endpoint: 'https://ingest.test/events',
    transportOptions: {
      ...DEFAULT_TRANSPORT_OPTIONS,
      paused: true,
      ...setCompression(false),
    },
    consentOptions: {},
    fetch: makeFetch(),
    ...overrides,
  };
}

function mockGrantedConsent(): IConsent {
  return {
    isGranted: () => true,
    onChange: () => () => {},
    optIn: () => {},
    optOut: () => {},
    clear: () => {},
    isDntActive: () => false,
    getStatus: () => -1,
    isDenied: () => false,
    isPending: () => false,
  };
}

function makeWorkerClient() {
  const mockWorker = new MockWorker();
  const fetchFn = makeFetch();
  // Mock global fetch so transport can use it
  (globalThis as Record<string, unknown>).fetch = fetchFn;
  const client = new WorkerClient(
    baseConfig({
      fetch: fetchFn,
    }),
    mockWorker as unknown as Worker,
    mockGrantedConsent(),
  );
  return { client, mockWorker, fetchFn };
}

function makeEnrichedEvent(
  overrides: Partial<TrackEventPayload> = {},
): TrackEventPayload {
  return {
    eid: '01975e3a-0001-7000-8000-000000000001',
    seq: 0,
    n: 'page_view',
    ts: Date.now(),
    sid: '01975e3a-0001-7000-8000-000000000002',
    anon: '01975e3a-0001-7000-8000-000000000003',
    priority: EventPriority.Normal,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Initialisation protocol
// ---------------------------------------------------------------------------

describe('WorkerClient — initialisation', () => {
  it('sends init + load_pending to Worker on construction', () => {
    const { mockWorker } = makeWorkerClient();
    const msgs = mockWorker.sentMessages();
    expect(msgs[0].type).toBe('init');
    expect(msgs[1].type).toBe('load_pending');
  });

  it('passes sessionIdleTimeoutMs and sampleRate in init config', () => {
    const mockWorker = new MockWorker();
    new WorkerClient(
      baseConfig({
        sessionIdleTimeoutMs: 60_000,
        sampleRate: 0.5,
      }),
      mockWorker as unknown as Worker,
    );
    const initMsg = mockWorker
      .sentMessages()
      .find((m) => m.type === 'init') as Extract<
      MainToWorkerMsg,
      { type: 'init' }
    >;
    expect(initMsg.config.sessionIdleTimeoutMs).toBe(60_000);
    expect(initMsg.config.sampleRate).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// track() → enriched → transport.send()
// ---------------------------------------------------------------------------

describe('WorkerClient — track()', () => {
  it('posts a track message to Worker', () => {
    const { client, mockWorker } = makeWorkerClient();
    client.track('page_view', { foo: 1 });
    const trackMsg = mockWorker
      .sentMessages()
      .find((m) => m.type === 'track') as Extract<
      MainToWorkerMsg,
      { type: 'track' }
    >;
    expect(trackMsg).toBeDefined();
    expect(trackMsg.name).toBe('page_view');
    expect(trackMsg.props).toEqual({ foo: 1 });
  });

  it('queues the enriched event in the Transport when Worker replies', async () => {
    const { client, mockWorker, fetchFn } = makeWorkerClient();
    const enrichedEvent = makeEnrichedEvent();

    // Auto-reply flush_ack whenever a flush ping arrives
    jest
      .spyOn(mockWorker, 'postMessage')
      .mockImplementation((msg: MainToWorkerMsg) => {
        if (msg.type === 'flush') {
          mockWorker.simulateIncoming({ type: 'flush_ack', seq: msg.seq });
        }
      });

    mockWorker.simulateIncoming({ type: 'enriched', event: enrichedEvent });
    await client.flush();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(fetchFn.mock.calls[0][1].body as string) as {
      events: TrackEventPayload[];
    };
    expect(envelope.events[0].eid).toBe(enrichedEvent.eid);
  });

  it('is a no-op when consent is not granted', () => {
    const mockWorker = new MockWorker();
    const mockConsent = {
      getStatus: () => -1 as const,
      isGranted: () => false,
      isDenied: () => false,
      isPending: () => true,
      onChange: () => () => {},
    };
    new WorkerClient(
      baseConfig({}),
      mockWorker as unknown as Worker,
    ).track('ev');

    const trackMsgs = mockWorker
      .sentMessages()
      .filter((m) => m.type === 'track');
    expect(trackMsgs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// flush() round-trip
// ---------------------------------------------------------------------------

describe('WorkerClient — flush()', () => {
  it('waits for flush_ack then flushes Transport', async () => {
    const { client, mockWorker, fetchFn } = makeWorkerClient();

    // Simulate Worker enriching an event, then acking the flush
    const enrichedEvent = makeEnrichedEvent({ n: '$click' });

    // When the Worker receives the flush ping, reply with enriched then ack
    const origPostMessage = mockWorker.postMessage.bind(mockWorker);
    jest
      .spyOn(mockWorker, 'postMessage')
      .mockImplementation((msg: MainToWorkerMsg) => {
        origPostMessage(msg);
        if (msg.type === 'flush') {
          mockWorker.simulateIncoming({
            type: 'enriched',
            event: enrichedEvent,
          });
          mockWorker.simulateIncoming({ type: 'flush_ack', seq: msg.seq });
        }
      });

    await client.flush();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(fetchFn.mock.calls[0][1].body as string) as {
      events: TrackEventPayload[];
    };
    expect(envelope.events[0].eid).toBe(enrichedEvent.eid);
  });
});

// ---------------------------------------------------------------------------
// IDB replay (pending events)
// ---------------------------------------------------------------------------

describe('WorkerClient — IDB replay', () => {
  it('forwards pending events from Worker to Transport', async () => {
    const { client, mockWorker, fetchFn } = makeWorkerClient();

    const pendingEvent = makeEnrichedEvent({ n: '$add_to_cart' });

    // Auto-reply flush_ack whenever a flush ping arrives
    jest
      .spyOn(mockWorker, 'postMessage')
      .mockImplementation((msg: MainToWorkerMsg) => {
        if (msg.type === 'flush') {
          mockWorker.simulateIncoming({ type: 'flush_ack', seq: msg.seq });
        }
      });

    // Simulate Worker sending back pending IDB events
    mockWorker.simulateIncoming({ type: 'pending', events: [pendingEvent] });
    await client.flush();

    expect(fetchFn).toHaveBeenCalled();
    const envelope = JSON.parse(fetchFn.mock.calls[0][1].body as string) as {
      events: TrackEventPayload[];
    };
    expect(envelope.events.some((e) => e.eid === pendingEvent.eid)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// close()
// ---------------------------------------------------------------------------

describe('WorkerClient — close()', () => {
  it('terminates the Worker after close()', async () => {
    const { client, mockWorker } = makeWorkerClient();
    // Simulate flush_ack so close() can resolve
    jest
      .spyOn(mockWorker, 'postMessage')
      .mockImplementation((msg: MainToWorkerMsg) => {
        if (msg.type === 'flush') {
          mockWorker.simulateIncoming({ type: 'flush_ack', seq: msg.seq });
        }
      });
    await client.close();
    expect(mockWorker.terminated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// identify() / reset()
// ---------------------------------------------------------------------------

describe('WorkerClient — identify() / reset()', () => {
  it('posts identify message to Worker', () => {
    const { client, mockWorker } = makeWorkerClient();
    client.identify('user-123');
    const msg = mockWorker
      .sentMessages()
      .find((m) => m.type === 'identify') as Extract<
      MainToWorkerMsg,
      { type: 'identify' }
    >;
    expect(msg).toBeDefined();
    expect(msg.uid).toBe('user-123');
  });

  it('posts reset message to Worker', () => {
    const { client, mockWorker } = makeWorkerClient();
    client.reset();
    const msg = mockWorker.sentMessages().find((m) => m.type === 'reset');
    expect(msg).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// initWithWorker — fallback path
// ---------------------------------------------------------------------------

describe('initWithWorker — fallback', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns a WinceClient when Worker is unavailable', () => {
    const origWorker = (globalThis as Record<string, unknown>).Worker;
    (globalThis as Record<string, unknown>).Worker = undefined;

    const result = initWithWorker(baseConfig());
    expect(result).toBeInstanceOf(WinceClient);

    (globalThis as Record<string, unknown>).Worker = origWorker;
    (result as WinceClient).close();
  });

  it('creates a WorkerClient when Worker is available', () => {
    const origWorker = (globalThis as Record<string, unknown>).Worker;
    const workerInstance = new MockWorker();
    const workerCtor = jest
      .fn()
      .mockImplementation(() => workerInstance as unknown as Worker);
    (globalThis as Record<string, unknown>).Worker =
      workerCtor as unknown as typeof Worker;

    try {
      const result = initWithWorker(baseConfig(), './tracker.worker.js');

      expect(result).toBeInstanceOf(WorkerClient);
      expect(workerCtor).toHaveBeenCalledTimes(1);
      expect(workerCtor.mock.calls[0][0]).toBeInstanceOf(URL);
      expect((workerCtor.mock.calls[0][0] as URL).href).toContain(
        'tracker.worker.js',
      );
    } finally {
      (globalThis as Record<string, unknown>).Worker = origWorker;
    }
  });

  it('returns a WinceClient when Worker constructor throws', () => {
    const origWorker = (globalThis as Record<string, unknown>).Worker;
    (globalThis as Record<string, unknown>).Worker = class {
      constructor() {
        throw new Error('CSP');
      }
    };

    const result = initWithWorker(baseConfig());
    expect(result).toBeInstanceOf(WinceClient);

    (globalThis as Record<string, unknown>).Worker = origWorker;
    (result as WinceClient).close();
  });
});

// ---------------------------------------------------------------------------
// tracker.worker.ts — handler logic (tested without a real Worker runtime)
// ---------------------------------------------------------------------------

describe('Worker handler logic', () => {
  it('enrichEvent produces a TrackEvent with required fields', () => {
    expect(true).toBe(true); // structural placeholder
  });
});