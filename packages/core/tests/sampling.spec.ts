import { SamplingFilter } from '../src/sampling.js';
import { SequenceCounter } from '../src/sequence.js';

// ============================================================================
// SequenceCounter
// ============================================================================

describe('SequenceCounter', () => {
  it('starts at 0', () => {
    expect(new SequenceCounter().current).toBe(0);
  });

  it('next() returns 0, 1, 2, …', () => {
    const c = new SequenceCounter();
    expect(c.next()).toBe(0);
    expect(c.next()).toBe(1);
    expect(c.next()).toBe(2);
  });

  it('current reflects next value without consuming it', () => {
    const c = new SequenceCounter();
    c.next(); // consume 0
    expect(c.current).toBe(1);
    expect(c.current).toBe(1); // unchanged
  });

  it('reset() brings counter back to 0', () => {
    const c = new SequenceCounter();
    c.next(); c.next(); c.next();
    c.reset();
    expect(c.next()).toBe(0);
  });
});

// ============================================================================
// SamplingFilter
// ============================================================================

describe('SamplingFilter', () => {
  it('rate=1.0 always tracks', () => {
    const f = new SamplingFilter({ rate: 1 });
    for (let i = 0; i < 50; i++) {
      expect(f.shouldTrack()).toBe(true);
    }
  });

  it('rate=0.0 never tracks', () => {
    const f = new SamplingFilter({ rate: 0 });
    for (let i = 0; i < 50; i++) {
      expect(f.shouldTrack()).toBe(false);
    }
  });

  it('throws RangeError for rate outside [0, 1]', () => {
    expect(() => new SamplingFilter({ rate: -0.1 })).toThrow(RangeError);
    expect(() => new SamplingFilter({ rate:  1.1 })).toThrow(RangeError);
  });

  it('same seed always returns the same result', () => {
    const f = new SamplingFilter({ rate: 0.5 });
    const seed = 'user-deterministic';
    const result = f.shouldTrack(seed);
    for (let i = 0; i < 20; i++) {
      expect(f.shouldTrack(seed)).toBe(result);
    }
  });

  it('different seeds produce varied results at rate=0.5 over many samples', () => {
    const f = new SamplingFilter({ rate: 0.5 });
    const results = new Set(
      Array.from({ length: 200 }, (_, i) => f.shouldTrack(`seed-${i}`)),
    );
    // With 200 different seeds and rate=0.5, both true and false should appear
    expect(results.has(true)).toBe(true);
    expect(results.has(false)).toBe(true);
  });

  it('exposes the configured rate', () => {
    expect(new SamplingFilter({ rate: 0.3 }).rate).toBe(0.3);
  });
});
