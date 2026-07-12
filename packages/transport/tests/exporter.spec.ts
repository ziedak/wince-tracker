import { Exporter, ExporterOptions } from '../src/lib/exporter.js';
import { HttpSender } from '../src/lib/httpSender.js';
import type { SendOutcome } from '../src/lib/sendOutcome.js';
import type { IHttpClient } from '../src/lib/clients/IHttpClient.js';
import { DEFAULT_BATCH_QUEUE_OPTS } from '../src/lib/batchQueue.js';
import { DEFAULT_TOKEN_BUCKET_OPTIONS } from '../src/lib/rateLimiter.js';
import { TrackEventPayload } from '@wince/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an HttpSender whose underlying client returns a controlled sequence of responses. */
function makeSender(responses: SendOutcome[]): HttpSender {
  let call = 0;
  const client: IHttpClient = {
    post: async () => {
      const outcome = responses[Math.min(call++, responses.length - 1)];
      const status =
        outcome.kind === 'ok'
          ? 200
          : outcome.kind === 'too-large'
            ? 413
            : outcome.kind === 'retry'
              ? 503
              : 400;
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
          get: () =>
            outcome.kind === 'retry' && 'retryAfterMs' in outcome
              ? String((outcome as { retryAfterMs?: number }).retryAfterMs ?? '')
              : null
        },
        body: null
      };
    }
  };
  return new HttpSender(client, {
    endpoint: 'https://ingest.test/e',
    requestTimeoutMs: 10_000
  });
}

/** Decode a body that may be a Uint8Array or string back to a string. */
function decodeBody(body: Uint8Array | string): string {
  if (typeof body === 'string') return body;
  return new TextDecoder().decode(body);
}

function testPayload(overrides: Partial<TrackEventPayload> = {}): TrackEventPayload {
  return {
    eid: '',
    seq: 0,
    n: '',
    ts: 0,
    sid: '',
    anon: '',
    priority: 0,
    ...overrides
  };
}

function makeExporterOpts(overrides: Partial<ExporterOptions<TrackEventPayload>> = {}): ExporterOptions<TrackEventPayload> {
  return {
    schemaVersion: 1,
    retry: { maxAttempts: 4, delayOpts: { baseDelayMs: 0, maxDelayMs: 0, factor: 2, jitter: false } },
    rateLimit: DEFAULT_TOKEN_BUCKET_OPTIONS,
    batch: {
      ...DEFAULT_BATCH_QUEUE_OPTS as Required<typeof DEFAULT_BATCH_QUEUE_OPTS>,
      batchSize: 10,
      flushIntervalMs: 60_000,
    },
    compressFn: async (input) => new TextEncoder().encode(input as string),
    onBatchDelivered: () => { /* noop */ },
    ...overrides
  };
}

function makeExporter(sender: HttpSender, overrides: Partial<ExporterOptions<TrackEventPayload>> = {}) {
  return new Exporter<TrackEventPayload>(sender, makeExporterOpts(overrides));
}

// ---------------------------------------------------------------------------
// Basic send
// ---------------------------------------------------------------------------

describe('Exporter — basic send', () => {
  it('flushes buffered items on flush()', async () => {
    let sentEvents: unknown[] = [];
    const client: IHttpClient = {
      post: async (_url, body) => {
        const envelope = JSON.parse(decodeBody(body)) as { events: unknown[]; sent_at: number };
        sentEvents = envelope.events;
        return { ok: true, status: 200, headers: { get: () => null }, body: null };
      }
    };
    const sender = new HttpSender(client, {
      endpoint: 'https://ingest.test/e',
      requestTimeoutMs: 10_000
    });
    const exp = makeExporter(sender);
    exp.enqueue(testPayload({ n: 'ev1' }));
    exp.enqueue(testPayload({ n: 'ev2' }));
    await exp.flush();
    expect(sentEvents).toHaveLength(2);
    await exp.close();
  });

  it('queueSize reflects buffered item count', async () => {
    const exp = makeExporter(makeSender([{ kind: 'ok' }]));
    expect(exp.queueSize).toBe(0);
    exp.enqueue(testPayload({ n: 'ev1' }));
    exp.enqueue(testPayload({ n: 'ev2' }));
    expect(exp.queueSize).toBe(2);
    await exp.flush();
    expect(exp.queueSize).toBe(0);
    await exp.close();
  });
});

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

describe('Exporter — circuit breaker', () => {
  function makeExporterCb(sender: HttpSender) {
    return new Exporter<TrackEventPayload>(sender, {
      schemaVersion: 1,
      retry: { maxAttempts: 1, delayOpts: { baseDelayMs: 0, maxDelayMs: 0, factor: 2, jitter: false } },
      rateLimit: DEFAULT_TOKEN_BUCKET_OPTIONS,
      batch: {
        ...DEFAULT_BATCH_QUEUE_OPTS as Required<typeof DEFAULT_BATCH_QUEUE_OPTS>,
        batchSize: 10,
        flushIntervalMs: 100,
      },
      compressFn: async (input) => new TextEncoder().encode(input as string),
      onBatchDelivered: () => { /* noop */ },
    });
  }

  it('opens after CB_THRESHOLD (3) consecutive batch failures', async () => {
    const sender = makeSender([{ kind: 'retry' }]); // always fails
    const exp = makeExporterCb(sender);

    // Three failures to open the circuit. attempts=1 → no retry delays.
    for (let i = 0; i < 3; i++) {
      exp.enqueue(testPayload({ n: `ev${i}` }));
      await exp.flush().catch((error) => {
        void error;
      });
    }

    // CB is open — a 4th flush must retain the new item (not send or drop it).
    const sizeBefore = exp.queueSize;
    exp.enqueue(testPayload({ n: 'ev99' }));
    await exp.flush().catch((error) => {
      void error;
    });
    expect(exp.queueSize).toBe(sizeBefore + 1);
    await exp.close();
  });

  it('closes after backoff timer fires and allows a probe flush', async () => {
    jest.useFakeTimers();
    try {
      // 3 failures open the circuit; the 4th send (probe) succeeds.
      const outcomes: SendOutcome[] = [
        { kind: 'retry' }, // flush 1
        { kind: 'retry' }, // flush 2
        { kind: 'retry' }, // flush 3 → CB opens, backoff = 100ms × 2 = 200ms
        { kind: 'ok' } // probe → CB closes, items sent
      ];
      const sender = makeSender(outcomes);
      const exp = makeExporterCb(sender);

      for (let i = 0; i < 3; i++) {
        exp.enqueue(testPayload({ n: `ev${i}` }));
        await exp.flush().catch((error) => {
          void error;
        });
      }

      expect(exp.queueSize).toBeGreaterThan(0);

      // Advance past the 200ms backoff so the CB timer fires and closes the circuit
      jest.advanceTimersByTime(300);
      await Promise.resolve();

      // Items should have been sent by the probe flush triggered by the CB timer
      // If not, do a manual flush now that the circuit is closed
      if (exp.queueSize > 0) {
        await exp.flush().catch(() => {/** */});
      }

      expect(exp.queueSize).toBe(0);
      await exp.close();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not count 4xx fatal responses as failures (drops batch)', async () => {
    const sender = makeSender([{ kind: 'fatal', status: 400 }]);
    const exp = makeExporterCb(sender);

    exp.enqueue(testPayload({ n: 'ev1' }));
    await exp.flush(); // fatal = drop, no failure counted

    exp.enqueue(testPayload({ n: 'ev2' }));
    await exp.flush();
    expect(exp.queueSize).toBe(0);
    await exp.close();
  });
});

// ---------------------------------------------------------------------------
// Retry behaviour
// ---------------------------------------------------------------------------

describe('Exporter — retry', () => {
  it('retries transient errors up to the attempt limit', async () => {
    let calls = 0;
    const client: IHttpClient = {
      post: async () => {
        calls++;
        return { ok: false, status: 503, headers: { get: () => null }, body: null };
      }
    };
    const sender = new HttpSender(client, {
      endpoint: 'https://ingest.test/e',
      requestTimeoutMs: 10_000
    });
    const exp = makeExporter(sender); // 4 attempts, 0 delay
    exp.enqueue(testPayload({ n: 'ev1' }));
    await exp.flush().catch((error) => {
      void error;
    });
    // 4 attempts total (initial + 3 retries)
    expect(calls).toBe(4);
    await exp.close();
  });

  it('halves the batch on 413 too-large and retries', async () => {
    const bodies: number[][] = [];
    const client: IHttpClient = {
      post: async (_url, body) => {
        const envelope = JSON.parse(decodeBody(body)) as { events: TrackEventPayload[] };
        bodies.push(envelope.events.map((e) => e.seq));
        const status = envelope.events.length > 1 ? 413 : 200;
        return { ok: status === 200, status, headers: { get: () => null }, body: null };
      }
    };
    const sender = new HttpSender(client, {
      endpoint: 'https://ingest.test/e',
      requestTimeoutMs: 10_000
    });
    const exp = makeExporter(sender);
    exp.enqueue(testPayload({ n: 'ev1', seq: 1 }));
    exp.enqueue(testPayload({ n: 'ev2', seq: 2 }));
    await exp.flush();
    // First attempt: 2 items → 413; second attempt: 1 item → 200
    expect(bodies[0]).toHaveLength(2);
    expect(bodies[1]).toHaveLength(1);
    await exp.close();
  });
});

// ---------------------------------------------------------------------------
// drain (synchronous beacon path)
// ---------------------------------------------------------------------------

describe('Exporter — drain()', () => {
  it('calls sendBeacon with encoded items and empties the buffer', () => {
    const origNavigator = (globalThis as Record<string, unknown>).navigator;
    const sentBlobs: Blob[] = [];
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        sendBeacon: (_url: string, data: Blob) => {
          sentBlobs.push(data);
          return true;
        }
      },
      configurable: true
    });

    try {
      const exp = makeExporter(makeSender([{ kind: 'ok' }]));
      exp.enqueue(testPayload({ n: 'ev1' }));
      exp.enqueue(testPayload({ n: 'ev2' }));

      exp.drain('https://ingest.test/e');

      expect(sentBlobs).toHaveLength(1);
      expect(exp.queueSize).toBe(0);
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: origNavigator, configurable: true });
    }
  });

  it('is a no-op when buffer is empty', () => {
    const origNavigator = (globalThis as Record<string, unknown>).navigator;
    const sentBlobs: Blob[] = [];
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        sendBeacon: (_url: string, data: Blob) => {
          sentBlobs.push(data);
          return true;
        }
      },
      configurable: true
    });

    try {
      const exp = makeExporter(makeSender([{ kind: 'ok' }]));
      exp.drain('https://ingest.test/e');
      expect(sentBlobs).toHaveLength(0);
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: origNavigator, configurable: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

describe('Exporter — rate limiter', () => {
  it('drops items when rate limit is exceeded', async () => {
    let calls = 0;
    const client: IHttpClient = {
      post: async (_url, body) => {
        calls += (JSON.parse(decodeBody(body)) as { events: unknown[] }).events.length;
        return { ok: true, status: 200, headers: { get: () => null }, body: null };
      }
    };
    const sender = new HttpSender(client, {
      endpoint: 'https://ingest.test/e',
      requestTimeoutMs: 10_000
    });
    // Bucket holds 1 token with a very long refill interval — only the first item gets through.
    const exp = makeExporter(sender, {
      rateLimit: { bucketSize: 1, refillRate: 1, refillIntervalMs: 60_000 }
    });

    exp.enqueue(testPayload({ n: 'ev1' })); // accepted (1 token consumed)
    exp.enqueue(testPayload({ n: 'ev2' })); // dropped (bucket empty)
    exp.enqueue(testPayload({ n: 'ev3' })); // dropped

    await exp.flush();
    expect(calls).toBe(1);
    await exp.close();
  });
});