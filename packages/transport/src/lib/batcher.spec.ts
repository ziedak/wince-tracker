import { Batcher } from './batcher';

describe('Batcher', () => {
  it('flushes when batch size is reached', async () => {
    const batches: any[][] = [];
    const b = new Batcher<number>((batch) => {
      batches.push(batch);
      return Promise.resolve();
    }, { batchSize: 3, batchTimeoutMs: 100 });

    b.add(1);
    b.add(2);
    expect(batches.length).toBe(0);
    b.add(3);
    // microtask allow sendFn to run
    await Promise.resolve();
    expect(batches.length).toBe(1);
    expect(batches[0]).toEqual([1, 2, 3]);
  });

  it('flushes on timeout', async () => {
    const batches: any[][] = [];
    const b = new Batcher<number>((batch) => {
      batches.push(batch);
      return Promise.resolve();
    }, { batchSize: 10, batchTimeoutMs: 10 });

    b.add(1);
    await new Promise((res) => setTimeout(res, 30));
    expect(batches.length).toBe(1);
  });
});
