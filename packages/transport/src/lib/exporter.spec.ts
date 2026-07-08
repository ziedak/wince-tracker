import { Exporter } from './exporter';
import { HttpSender } from './httpSender';
import type { SendOutcome } from './sendOutcome';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an HttpSender whose underlying fetch returns a controlled sequence of responses. */
function makeSender(responses: SendOutcome[]): HttpSender {
  let call = 0;
  const sender = new HttpSender({
    endpoint: 'https://ingest.test/e',
    fetch: () => {
      const outcome = responses[Math.min(call++, responses.length - 1)];
      const status =
        outcome.kind === 'ok'        ? 200 :
        outcome.kind === 'too-large' ? 413 :
        outcome.kind === 'retry'     ? 503 : 400;
      return Promise.resolve({
        ok:      status >= 200 && status < 300,
        status,
        headers: {
          get: () =>
            outcome.kind === 'retry' && 'retryAfterMs' in outcome
              ? String((outcome as { retryAfterMs?: number }).retryAfterMs ?? '')
              : null,
        },
      } as unknown as Response);
    },
  });
  return sender;
}

function makeExporter(sender: HttpSender, overrides: Record<string, unknown> = {}) {
  return new Exporter<{ id: number }>({
    encode:          (b: { id: number }[]) => JSON.stringify(b),
    sender,
    batchSize:       10,
    flushIntervalMs: 60_000, // long — prevent auto-flush interfering
    retry: { attempts: 4, baseDelayMs: 0, maxDelayMs: 0, jitter: false },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Basic send
// ---------------------------------------------------------------------------

describe('Exporter — basic send', () => {
  it('flushes buffered items on flush()', async () => {
    let sent: unknown[] = [];
    const sender = new HttpSender({
      endpoint: 'https://ingest.test/e',
      fetch: (_url: string, init: RequestInit) => {
        sent = JSON.parse(init.body as string) as unknown[];
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => null } } as unknown as Response);
      },
    });
    const exp = makeExporter(sender);
    exp.enqueue({ id: 1 });
    exp.enqueue({ id: 2 });
    await exp.flush();
    expect(sent).toHaveLength(2);
    await exp.close();
  });

  it('queueSize reflects buffered item count', async () => {
    const exp = makeExporter(makeSender([{ kind: 'ok' }]));
    expect(exp.queueSize).toBe(0);
    exp.enqueue({ id: 1 });
    exp.enqueue({ id: 2 });
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
  // attempts:1 → one send call per flush, no retry-delay timers created inside _sendBatch.
  // flushIntervalMs:100 → CB backoff = 100ms × 2^1 = 200ms (easy to advance with fake timers).
  function makeExporterCb(sender: HttpSender) {
    return new Exporter<{ id: number }>({
      encode:          (b: { id: number }[]) => JSON.stringify(b),
      sender,
      batchSize:       10,
      flushIntervalMs: 100,
      retry: { attempts: 1, baseDelayMs: 0, maxDelayMs: 0, jitter: false },
    });
  }

  it('opens after CB_THRESHOLD (3) consecutive batch failures', async () => {
    const sender = makeSender([{ kind: 'retry' }]); // always fails
    const exp = makeExporterCb(sender);

    // Three failures to open the circuit. attempts=1 → no retry delays.
    for (let i = 0; i < 3; i++) {
      exp.enqueue({ id: i });
      await exp.flush().catch((error) => { void error; });
    }

    // CB is open — a 4th flush must retain the new item (not send or drop it).
    const sizeBefore = exp.queueSize;
    exp.enqueue({ id: 99 });
    await exp.flush().catch((error) => { void error; });
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
        { kind: 'ok'    }, // probe → CB closes, items sent
      ];
      const sender = makeSender(outcomes);
      const exp = makeExporterCb(sender);

      for (let i = 0; i < 3; i++) {
        exp.enqueue({ id: i });
        await exp.flush().catch((error) => { void error; });
      }

      expect(exp.queueSize).toBeGreaterThan(0);

      // Advance past the 200ms backoff — probe flush runs and empties the buffer.
      jest.advanceTimersByTime(300);
      await Promise.resolve();

      expect(exp.queueSize).toBe(0);
      await exp.close();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not count 4xx fatal responses as failures (drops batch)', async () => {
    const sender = makeSender([{ kind: 'fatal', status: 400 }]);
    const exp = makeExporterCb(sender);

    exp.enqueue({ id: 1 });
    await exp.flush(); // fatal = drop, no failure counted

    exp.enqueue({ id: 2 });
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
    const sender = new HttpSender({
      endpoint: 'https://ingest.test/e',
      fetch: () => {
        calls++;
        return Promise.resolve({ ok: false, status: 503, headers: { get: () => null } } as unknown as Response);
      },
    });
    const exp = makeExporter(sender); // 4 attempts, 0 delay
    exp.enqueue({ id: 1 });
    await exp.flush().catch((error) => { void error; });
    // 4 attempts total (initial + 3 retries)
    expect(calls).toBe(4);
    await exp.close();
  });

  it('halves the batch on 413 too-large and retries', async () => {
    const bodies: number[][] = [];
    const sender = new HttpSender({
      endpoint: 'https://ingest.test/e',
      fetch: (_url: string, init: RequestInit) => {
        const batch = JSON.parse(init.body as string) as { id: number }[];
        bodies.push(batch.map((b) => b.id));
        const status = batch.length > 1 ? 413 : 200;
        return Promise.resolve({ ok: status === 200, status, headers: { get: () => null } } as unknown as Response);
      },
    });
    const exp = makeExporter(sender);
    exp.enqueue({ id: 1 });
    exp.enqueue({ id: 2 });
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
  it('calls send with encoded items and empties the buffer', () => {
    const sent: (string | Uint8Array)[] = [];
    const exp = makeExporter(makeSender([{ kind: 'ok' }]));
    exp.enqueue({ id: 1 });
    exp.enqueue({ id: 2 });

    exp.drain({
      encodeSync: (b: { id: number }[]) => JSON.stringify(b),
      send:       (data: string | Uint8Array) => sent.push(data),
    });

    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0] as string)).toHaveLength(2);
    expect(exp.queueSize).toBe(0);
  });

  it('is a no-op when buffer is empty', () => {
    const sent: (string | Uint8Array)[] = [];
    const exp = makeExporter(makeSender([{ kind: 'ok' }]));
    exp.drain({ encodeSync: JSON.stringify, send: (d: string | Uint8Array) => sent.push(d) });
    expect(sent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

describe('Exporter — rate limiter', () => {
  it('drops items when rate limit is exceeded', async () => {
    let calls = 0;
    const sender = new HttpSender({
      endpoint: 'https://ingest.test/e',
      fetch: (_url: string, init: RequestInit) => {
        calls += (JSON.parse(init.body as string) as unknown[]).length;
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => null } } as unknown as Response);
      },
    });
    // Bucket holds 1 token with a very long refill interval — only the first item gets through.
    const exp = makeExporter(sender, {
      rateLimit: { bucketSize: 1, refillRate: 1, refillIntervalMs: 60_000 },
    });

    exp.enqueue({ id: 1 }); // accepted (1 token consumed)
    exp.enqueue({ id: 2 }); // dropped (bucket empty)
    exp.enqueue({ id: 3 }); // dropped

    await exp.flush();
    expect(calls).toBe(1);
    await exp.close();
  });
});
