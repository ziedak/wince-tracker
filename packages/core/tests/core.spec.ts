// Barrel-level smoke test — verifies all named exports are present and usable
// without re-testing implementation details (each module has its own spec).

import { isValidUuidv4 } from '@wince/utils';
import { IdentityManager } from '../src/identity.js';
import { Pipeline } from '../src/pipeline.js';
import { SamplingFilter } from '../src/sampling.js';
import { SequenceCounter } from '../src/sequence.js';
import { SessionManager } from '../src/session.js';


describe('@wince/core barrel exports', () => {


  it('Pipeline drops event on null return', () => {
    const p = new Pipeline<{ t: string }>().use(() => null);
    expect(p.run({ t: 'ev' })).toBeUndefined();
  });

  it('SessionManager returns a session ID', () => {
    const mgr = new SessionManager();
    expect(isValidUuidv4(mgr.getSid())).toBe(true);
    mgr.destroy();
  });

  it('IdentityManager returns an anonymous ID', () => {
    const mgr = new IdentityManager();
    expect(isValidUuidv4(mgr.getAnonId())).toBe(true);
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
