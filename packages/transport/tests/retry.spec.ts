import { withRetries, backoffDelay } from '../src/lib/retry.js';

describe('backoffDelay', () => {
  it('returns increasing delays without jitter', () => {
    const a = backoffDelay(0, { baseDelayMs: 10, factor: 2, maxDelayMs: 1000, jitter: false });
    const b = backoffDelay(1, { baseDelayMs: 10, factor: 2, maxDelayMs: 1000, jitter: false });
    expect(b).toBeGreaterThanOrEqual(a);
  });
});

describe('withRetries', () => {
  it('retries until success', async () => {
    let calls = 0;
    const res = await withRetries(
      async () => {
        calls++;
        if (calls < 3) throw new Error('fail');
        return 'ok';
      },
      4,
    );
    expect(res).toBe('ok');
    expect(calls).toBe(3);
  });
});
