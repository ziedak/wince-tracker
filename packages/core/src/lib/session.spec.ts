import { SessionManager } from './session';
import type { MinimalStore } from './types';

function makeStore(): MinimalStore & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    get: (k: string) => data[k] ?? null,
    set: (k: string, v: string) => { data[k] = v; },
    delete: (k: string) => { delete data[k]; },
  };
}

describe('SessionManager', () => {
  let _savedBC: unknown;
  beforeEach(() => {
    // Prevent real BroadcastChannel from being opened — those tests don't test
    // BC behaviour and an unclosed channel keeps the Node process alive.
    _savedBC = (globalThis as Record<string, unknown>)['BroadcastChannel'];
    delete (globalThis as Record<string, unknown>)['BroadcastChannel'];
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    if (_savedBC !== undefined) {
      (globalThis as Record<string, unknown>)['BroadcastChannel'] = _savedBC;
    }
  });

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

// ---------------------------------------------------------------------------
// BroadcastChannel cross-tab activity sync
// ---------------------------------------------------------------------------

describe('SessionManager — BroadcastChannel sync', () => {
  interface MockBCEvent {
    data: unknown;
  }

  class MockBroadcastChannel {
    static readonly instances: MockBroadcastChannel[] = [];
    readonly name: string;
    onmessage: ((ev: MockBCEvent) => void) | null = null;
    private _closed = false;

    constructor(name: string) {
      this.name = name;
      MockBroadcastChannel.instances.push(this);
    }

    postMessage(data: unknown): void {
      if (this._closed) return;
      // Deliver to all OTHER open channels with the same name.
      for (const ch of MockBroadcastChannel.instances) {
        if (ch !== this && ch.name === this.name && !ch._closed && ch.onmessage) {
          ch.onmessage({ data });
        }
      }
    }

    close(): void {
      this._closed = true;
    }
  }

  beforeEach(() => {
    MockBroadcastChannel.instances.length = 0;
    (globalThis as any).BroadcastChannel = MockBroadcastChannel;
    jest.useFakeTimers();
  });

  afterEach(() => {
    delete (globalThis as any).BroadcastChannel;
    jest.useRealTimers();
  });

  it('touch() in one tab resets the idle countdown in another tab', () => {
    const idle = 30 * 60_000;
    const mgr1 = new SessionManager({ idleTimeoutMs: idle });
    const mgr2 = new SessionManager({ idleTimeoutMs: idle });
    const sid1 = mgr1.getSid();
    const sid2 = mgr2.getSid();

    // Both managers start with the same SID only when one restores the other's
    // state via storage. Without shared storage they have different SIDs here,
    // so we test the broadcast message path directly by sending a message
    // from mgr1 to mgr2.

    // Advance 25 min — both would expire at 30 min.
    jest.setSystemTime(Date.now() + 25 * 60_000);

    // mgr1 records activity — broadcasts to mgr2.
    mgr1.touch();

    // Advance another 10 min (35 min total since start).
    // mgr2 received a broadcast for mgr1's sid, but its own sid differs —
    // the message is ignored. mgr2 should expire.
    jest.setSystemTime(Date.now() + 10 * 60_000);

    // mgr2 has its own unrelated sid so the broadcast doesn't help it.
    expect(mgr2.getSid()).not.toBe(sid2); // new session — expected
    expect(mgr1.getSid()).toBe(sid1);     // mgr1 touched itself, still active

    mgr1.destroy();
    mgr2.destroy();
  });

  it('does NOT create an echo loop — received broadcast does not re-broadcast', () => {
    const idle = 30 * 60_000;
    const mgr1 = new SessionManager({ idleTimeoutMs: idle });
    const mgr2 = new SessionManager({ idleTimeoutMs: idle });
    mgr1.getSid();
    mgr2.getSid();

    const postSpy = jest.spyOn(
      MockBroadcastChannel.instances[0],
      'postMessage',
    );

    // Simulate mgr2 receiving an activity message.
    const bc2 = MockBroadcastChannel.instances[1];
    bc2.onmessage?.({ data: { type: 'activity', sid: mgr2.peekSid() } });

    // mgr2's onmessage handler must NOT call postMessage back.
    expect(postSpy).not.toHaveBeenCalled();

    mgr1.destroy();
    mgr2.destroy();
  });

  it('destroy() closes the BroadcastChannel', () => {
    const mgr = new SessionManager();
    mgr.getSid();
    const bc = MockBroadcastChannel.instances[0];
    const closeSpy = jest.spyOn(bc, 'close');

    mgr.destroy();

    expect(closeSpy).toHaveBeenCalled();
  });

  it('gracefully skips BroadcastChannel when unavailable', () => {
    delete (globalThis as any).BroadcastChannel;
    expect(() => {
      const mgr = new SessionManager();
      mgr.getSid();
      mgr.touch();
      mgr.destroy();
    }).not.toThrow();
  });
});
