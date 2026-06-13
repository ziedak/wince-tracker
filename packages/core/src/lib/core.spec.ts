// Barrel-level smoke test — verifies all named exports are present and usable
// without re-testing implementation details (each module has its own spec).

import {
  Pipeline, SessionManager, IdentityManager, SequenceCounter, SamplingFilter,
  uuidv4, uuidv7, isValidUuid,
} from './core';

describe('@wince/core barrel exports', () => {
  it('uuidv7 produces a valid time-ordered UUID', () => {
    expect(isValidUuid(uuidv7())).toBe(true);
  });

  it('uuidv4 produces a valid random UUID', () => {
    expect(isValidUuid(uuidv4())).toBe(true);
  });

  it('Pipeline drops event on null return', () => {
    const p = new Pipeline<{ t: string }>().use(() => null);
    expect(p.run({ t: 'ev' })).toBeUndefined();
  });

  it('SessionManager returns a session ID', () => {
    const mgr = new SessionManager();
    expect(isValidUuid(mgr.getSid())).toBe(true);
    mgr.destroy();
  });

  it('IdentityManager returns an anonymous ID', () => {
    const mgr = new IdentityManager();
    expect(isValidUuid(mgr.getAnonId())).toBe(true);
  });

  it('SequenceCounter increments', () => {
    const c = new SequenceCounter();
    expect(c.next()).toBe(0);
    expect(c.next()).toBe(1);
  });

  it('SamplingFilter at rate=1 always tracks', () => {
    const f = new SamplingFilter({ rate: 1 });
    expect(f.shouldTrack()).toBe(true);
  });
});

