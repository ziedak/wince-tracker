import { MessagingClient, type ServerCommand } from '../src/lib/messaging.js';
import type { IHttpClient, IHttpResponse } from '@wince/transport';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeMockHttpClient(responseCommands: ServerCommand[] = []): IHttpClient {
  return {
    post: async (): Promise<IHttpResponse> => {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: JSON.stringify({ commands: responseCommands }) as any
      };
    }
  };
}

// ---------------------------------------------------------------------------
// MessagingClient — deduplication
// ---------------------------------------------------------------------------

describe('MessagingClient — deduplication', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('skips duplicate commands with same requestId', async () => {
    const received: ServerCommand[] = [];
    const cmd: ServerCommand = { type: 'show_survey', payload: null, requestId: 'dup-1' };

    const messaging = new MessagingClient({
      wsUrl: 'ws://localhost:8080/ws',
      httpUrl: 'http://localhost:8080/commands/poll',
      onCommand: (c) => {
        received.push(c);
      },
      pollIntervalMs: 1000
    });

    // Mock HTTP to return the same command twice
    let callCount = 0;
    const mockHttp: IHttpClient = {
      post: async () => {
        callCount++;
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          body: JSON.stringify({ commands: [cmd] }) as any
        };
      }
    };
    (messaging as unknown as { _httpClient: IHttpClient })._httpClient = mockHttp;

    messaging.start();

    // First poll — command dispatched
    await jest.advanceTimersByTimeAsync(100);
    expect(received).toHaveLength(1);

    // Second poll — same command, should be deduplicated
    await jest.advanceTimersByTimeAsync(1000);
    expect(received).toHaveLength(1);

    messaging.stop();
  });

  it('processes different requestIds', async () => {
    const received: ServerCommand[] = [];

    const messaging = new MessagingClient({
      wsUrl: 'ws://localhost:8080/ws',
      httpUrl: 'http://localhost:8080/commands/poll',
      onCommand: (_c) => {
        received.push(_c);
      },
      pollIntervalMs: 1000
    });

    const commands: ServerCommand[] = [
      { type: 'cmd1', payload: null, requestId: 'r1' },
      { type: 'cmd2', payload: null, requestId: 'r2' }
    ];
    const mockHttp = makeMockHttpClient(commands);
    (messaging as unknown as { _httpClient: IHttpClient })._httpClient = mockHttp;

    messaging.start();
    await jest.advanceTimersByTimeAsync(100);

    expect(received).toHaveLength(2);
    expect(received.map((r) => r.requestId)).toEqual(['r1', 'r2']);

    messaging.stop();
  });

  it('enforces maxDeduplicationEntries limit', async () => {
    const received: ServerCommand[] = [];

    const messaging = new MessagingClient({
      wsUrl: 'ws://localhost:8080/ws',
      httpUrl: 'http://localhost:8080/commands/poll',
      onCommand: (c) => {
        received.push(c);
      },
      pollIntervalMs: 1000,
      maxDeduplicationEntries: 3
    });

    // Process 4 unique commands — this evicts r1 (FIFO with max=3)
    const cmds1: ServerCommand[] = [
      { type: 'cmd', payload: null, requestId: 'r1' },
      { type: 'cmd', payload: null, requestId: 'r2' },
      { type: 'cmd', payload: null, requestId: 'r3' },
      { type: 'cmd', payload: null, requestId: 'r4' }
    ];
    const mockHttp1 = makeMockHttpClient(cmds1);
    (messaging as unknown as { _httpClient: IHttpClient })._httpClient = mockHttp1;

    messaging.start();
    await jest.advanceTimersByTimeAsync(100);
    expect(received).toHaveLength(4);

    // r1 was evicted when r4 was processed, so r1 should be re-processed
    const cmds2: ServerCommand[] = [
      { type: 'cmd', payload: null, requestId: 'r1' }
    ];
    const mockHttp2 = makeMockHttpClient(cmds2);
    (messaging as unknown as { _httpClient: IHttpClient })._httpClient = mockHttp2;

    await jest.advanceTimersByTimeAsync(1000);
    expect(received).toHaveLength(5); // r1 re-processed after eviction

    messaging.stop();
  });
});

// ---------------------------------------------------------------------------
// MessagingClient — connection state
// ---------------------------------------------------------------------------

describe('MessagingClient — connection state', () => {
  it('connected returns false initially', () => {
    const messaging = new MessagingClient({
      wsUrl: 'ws://localhost:8080/ws',
      httpUrl: 'http://localhost:8080/commands/poll',
      onCommand: () => { /* noop */ }
    });
    expect(messaging.connected).toBe(false);
    expect(messaging.anyConnected).toBe(false);
    messaging.stop();
  });

  it('anyConnected reflects HTTP poll state', async () => {
    jest.useFakeTimers();
    try {
      const messaging = new MessagingClient({
        wsUrl: 'ws://localhost:8080/ws',
        httpUrl: 'http://localhost:8080/commands/poll',
      onCommand: () => { /* noop */ },
      pollIntervalMs: 1000
      });

      const mockHttp = makeMockHttpClient([]);
      (messaging as unknown as { _httpClient: IHttpClient })._httpClient = mockHttp;

      messaging.start();
      await jest.advanceTimersByTimeAsync(100);

      // WS not connected, but HTTP poll succeeded
      expect(messaging.connected).toBe(false);
      expect(messaging.anyConnected).toBe(true);

      messaging.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it('stop() clears all connection state', () => {
    const messaging = new MessagingClient({
      wsUrl: 'ws://localhost:8080/ws',
      httpUrl: 'http://localhost:8080/commands/poll',
      onCommand: () => { /* noop */ }
    });
    messaging.start();
    messaging.stop();
    expect(messaging.connected).toBe(false);
    expect(messaging.anyConnected).toBe(false);
  });
});