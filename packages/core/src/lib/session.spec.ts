import { SessionManager } from './session';
import type { MinimalStore } from './types';

function makeStore(): MinimalStore & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    get: (k) => data[k] ?? null,
    set: (k, v) => { data[k] = v; },
    delete: (k) => { delete data[k]; },
  };
}

describe('SessionManager', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns a valid UUID for the session ID', () => {
    const mgr = new SessionManager();
    expect(mgr.getSid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('returns the same session ID within the idle window', () => {
    const mgr = new SessionManager({ idleTimeoutMs: 30 * 60_000 });
    const sid1 = mgr.getSid();
    jest.setSystemTime(Date.now() + 29 * 60_000);
    const sid2 = mgr.getSid();
    expect(sid1).toBe(sid2);
  });

  it('creates a new session after idle timeout', () => {
    const mgr = new SessionManager({ idleTimeoutMs: 30 * 60_000 });
    const sid1 = mgr.getSid();
    jest.setSystemTime(Date.now() + 31 * 60_000);
    const sid2 = mgr.getSid();
    expect(sid1).not.toBe(sid2);
  });

  it('touch() extends the session lifetime', () => {
    const mgr = new SessionManager({ idleTimeoutMs: 30 * 60_000 });
    const sid1 = mgr.getSid();

    // Advance 25 min, touch, advance another 25 min — still the same session
    jest.setSystemTime(Date.now() + 25 * 60_000);
    mgr.touch();
    jest.setSystemTime(Date.now() + 25 * 60_000);
    const sid2 = mgr.getSid();

    expect(sid1).toBe(sid2);
  });

  it('touch() starts a new session when idle has elapsed', () => {
    const mgr = new SessionManager({ idleTimeoutMs: 30 * 60_000 });
    const sid1 = mgr.getSid();
    jest.setSystemTime(Date.now() + 31 * 60_000);
    mgr.touch();
    expect(mgr.getSid()).not.toBe(sid1);
  });

  it('reset() immediately creates a new session', () => {
    const mgr = new SessionManager();
    const sid1 = mgr.getSid();
    mgr.reset();
    expect(mgr.getSid()).not.toBe(sid1);
  });

  it('persists session to the store', () => {
    const store = makeStore();
    const mgr = new SessionManager({ store });
    mgr.getSid();
    expect(store.data['wince_session']).toBeDefined();
  });

  it('restores an active session from the store on construction', () => {
    const store = makeStore();
    const mgr1 = new SessionManager({ store });
    const sid = mgr1.getSid();

    // New manager instance — should restore the same session
    const mgr2 = new SessionManager({ store });
    expect(mgr2.getSid()).toBe(sid);
  });

  it('ignores corrupted store data and starts fresh', () => {
    const store = makeStore();
    store.data['wince_session'] = 'not-valid-json{{{{';
    const mgr = new SessionManager({ store });
    expect(mgr.getSid()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('startedAt reflects session creation time', () => {
    const now = Date.now();
    const mgr = new SessionManager();
    mgr.getSid(); // trigger session start
    expect(mgr.startedAt).toBeGreaterThanOrEqual(now);
    expect(mgr.startedAt).toBeLessThanOrEqual(Date.now());
  });
});
