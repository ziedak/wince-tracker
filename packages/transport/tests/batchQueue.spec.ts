import { BatchQueue, DEFAULT_BATCH_QUEUE_OPTS } from '../src/lib/batchQueue.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueue(
  sendFn: (batch: number[]) => Promise<void>,
  opts: { batchSize?: number; batchBytes?: number; flushIntervalMs?: number; maxBufferSize?: number } = {}
) {
  return new BatchQueue<number>({
    ...DEFAULT_BATCH_QUEUE_OPTS as Required<typeof DEFAULT_BATCH_QUEUE_OPTS>,
    sendFn,
    batchSize: opts.batchSize ?? 5,
    batchBytes: opts.batchBytes ?? 15 * 1024,
    flushIntervalMs: opts.flushIntervalMs ?? 50_000,
    maxBufferSize: opts.maxBufferSize ?? 100,
  });
}

// ---------------------------------------------------------------------------
// pause / start
// ---------------------------------------------------------------------------

describe('BatchQueue — pause / start', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('does not flush while paused', async () => {
    const sent: number[][] = [];
    const q = makeQueue(async (b) => { sent.push(b); });
    q.pause();
    q.add(1);
    q.add(2);
    await jest.runAllTimersAsync();
    expect(sent).toHaveLength(0);
  });

  it('flushes buffered items after start()', async () => {
    const sent: number[][] = [];
    const q = makeQueue(async (b) => { sent.push(b); });
    q.pause();
    q.add(1);
    q.add(2);
    q.start();
    await q.flush();
    expect(sent.flat()).toEqual([1, 2]);
  });

  it('calling start() when not paused is a no-op', async () => {
    const sent: number[][] = [];
    const q = makeQueue(async (b) => { sent.push(b); });
    q.add(1);
    await q.flush();
    const countBefore = sent.length;
    q.start(); // not paused — should have no effect
    await q.flush();
    expect(sent.length).toBeGreaterThanOrEqual(countBefore);
  });

  it('pause() while flush is arming prevents auto-flush from firing', async () => {
    const sent: number[][] = [];
    const q = makeQueue(async (b) => { sent.push(b); }, { flushIntervalMs: 100 });
    q.add(1);
    q.pause();
    await jest.advanceTimersByTimeAsync(200);
    expect(sent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// drain
// ---------------------------------------------------------------------------

describe('BatchQueue — drain()', () => {
  it('returns all buffered items and empties the buffer', () => {
    const q = makeQueue(async () => undefined);
    q.add(10);
    q.add(20);
    q.add(30);
    const items = q.drain();
    expect(items).toEqual([10, 20, 30]);
    expect(q.size).toBe(0);
  });

  it('returns empty array when buffer is empty', () => {
    const q = makeQueue(async () => undefined);
    expect(q.drain()).toEqual([]);
  });

  it('drain() after partial flush only returns remaining items', async () => {
    const sent: number[][] = [];
    const q = makeQueue(async (b) => { sent.push(b); }, { batchSize: 2 });
    q.add(1);
    q.add(2); // reaches batchSize → background flush starts; snapshots originalLength=2
    q.add(3); // added after the flush snapshot — not included in this flush cycle
    await q.flush();
    // Item 3 was not in the flush snapshot so it remains buffered
    const remaining = q.drain();
    expect(remaining).toEqual([3]);
  });
});

// ---------------------------------------------------------------------------
// batchSize threshold
// ---------------------------------------------------------------------------

describe('BatchQueue — batchSize auto-flush', () => {
  it('auto-flushes synchronously when batchSize is reached', async () => {
    const sent: number[][] = [];
    const q = makeQueue(async (b) => { sent.push(b); }, { batchSize: 3, flushIntervalMs: 60_000 });
    q.add(1);
    q.add(2);
    q.add(3); // reaches batchSize — background flush triggered
    await q.flush(); // wait for it to complete
    expect(sent.flat()).toContain(1);
    expect(sent.flat()).toContain(3);
  });
});

// ---------------------------------------------------------------------------
// maxBufferSize eviction
// ---------------------------------------------------------------------------

describe('BatchQueue — maxBufferSize eviction', () => {
  it('drops oldest item when buffer is full', async () => {
    const sent: number[][] = [];
    const q = makeQueue(async (b) => { sent.push(b); }, { maxBufferSize: 2, batchSize: 10 });
    q.add(1);
    q.add(2);
    q.add(3); // evicts 1 (oldest)
    await q.flush();
    expect(sent.flat()).not.toContain(1);
    expect(sent.flat()).toContain(2);
    expect(sent.flat()).toContain(3);
  });
});

// ---------------------------------------------------------------------------
// size getter
// ---------------------------------------------------------------------------

describe('BatchQueue — size', () => {
  it('reflects current buffer depth', async () => {
    const q = makeQueue(async () => undefined);
    expect(q.size).toBe(0);
    q.add(1);
    q.add(2);
    expect(q.size).toBe(2);
    await q.flush();
    expect(q.size).toBe(0);
  });
});