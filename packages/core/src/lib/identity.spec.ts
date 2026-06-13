import { IdentityManager } from './identity';
import type { MinimalStore } from './types';

function makeStore(): MinimalStore & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    get:    (k: string) => data[k] ?? null,
    set:    (k: string, v: string) => { data[k] = v; },
    delete: (k: string) => { delete data[k]; },
  };
}

const UUID4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('IdentityManager', () => {
  it('generates a UUID v4 anonymous ID', () => {
    const mgr = new IdentityManager();
    expect(mgr.getAnonId()).toMatch(UUID4_RE);
  });

  it('getUserId() is undefined initially', () => {
    const mgr = new IdentityManager();
    expect(mgr.getUserId()).toBeUndefined();
  });

  it('persists anonId to the store', () => {
    const store = makeStore();
    const mgr = new IdentityManager({ store });
    expect(store.data['wince_anon']).toBe(mgr.getAnonId());
  });

  it('restores anonId from the store on construction', () => {
    const store = makeStore();
    const mgr1 = new IdentityManager({ store });
    const anon = mgr1.getAnonId();

    const mgr2 = new IdentityManager({ store });
    expect(mgr2.getAnonId()).toBe(anon);
  });

  it('generates a new anonId when stored value is invalid', () => {
    const store = makeStore();
    store.data['wince_anon'] = 'not-a-uuid';
    const mgr = new IdentityManager({ store });
    expect(mgr.getAnonId()).toMatch(UUID4_RE);
  });

  it('identify() sets getUserId()', () => {
    const mgr = new IdentityManager();
    mgr.identify('user-123');
    expect(mgr.getUserId()).toBe('user-123');
  });

  it('identify() persists userId to the store', () => {
    const store = makeStore();
    const mgr = new IdentityManager({ store });
    mgr.identify('user-abc');
    expect(store.data['wince_uid']).toBe('user-abc');
  });

  it('restores userId from the store on construction', () => {
    const store = makeStore();
    const mgr1 = new IdentityManager({ store });
    mgr1.identify('user-xyz');

    const mgr2 = new IdentityManager({ store });
    expect(mgr2.getUserId()).toBe('user-xyz');
  });

  it('reset() generates a new anonId', () => {
    const mgr = new IdentityManager();
    const anon1 = mgr.getAnonId();
    mgr.reset();
    expect(mgr.getAnonId()).not.toBe(anon1);
    expect(mgr.getAnonId()).toMatch(UUID4_RE);
  });

  it('reset() clears userId', () => {
    const mgr = new IdentityManager();
    mgr.identify('user-999');
    mgr.reset();
    expect(mgr.getUserId()).toBeUndefined();
  });

  it('reset() removes userId from the store', () => {
    const store = makeStore();
    const mgr = new IdentityManager({ store });
    mgr.identify('user-del');
    mgr.reset();
    expect(store.data['wince_uid']).toBeUndefined();
  });
});
