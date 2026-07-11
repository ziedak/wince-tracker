import { BeaconClient } from '../src/lib/beaconClient.js';

describe('BeaconClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses sendBeacon with string payloads when available', async () => {
    const sendBeacon = jest.fn().mockReturnValue(true);
    const originalNavigator = (globalThis as Record<string, unknown>).navigator;

    Object.defineProperty(globalThis, 'navigator', {
      value: { sendBeacon },
      configurable: true,
    });

    try {
      const client = new BeaconClient();
      await expect(client.post('https://example.test/ingest', 'payload')).resolves.toEqual({
        ok: true,
        status: 200,
      });
      expect(sendBeacon).toHaveBeenCalledWith('https://example.test/ingest', 'payload');
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    }
  });

  it('wraps binary payloads in a Blob and falls back on beacon errors', async () => {
    const fallbackPost = jest.fn().mockResolvedValue({ ok: true, status: 201 });
    const sendBeacon = jest.fn(() => { throw new Error('boom'); });
    const originalNavigator = (globalThis as Record<string, unknown>).navigator;

    Object.defineProperty(globalThis, 'navigator', {
      value: { sendBeacon },
      configurable: true,
    });

    try {
      const client = new BeaconClient({ post: fallbackPost } as never);
      const payload = new Uint8Array([1, 2, 3]);

      await expect(client.post('https://example.test/ingest', payload)).resolves.toEqual({
        ok: true,
        status: 201,
      });

      expect(sendBeacon).toHaveBeenCalledTimes(1);
      expect((sendBeacon.mock.calls[0] as unknown as [string, Blob])[1]).toBeInstanceOf(Blob);
      expect(fallbackPost).toHaveBeenCalledWith('https://example.test/ingest', payload, {});
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    }
  });

  it('falls back to FetchClient when sendBeacon is unavailable', async () => {
    const fallbackPost = jest.fn().mockResolvedValue({ ok: true, status: 202 });
    const originalNavigator = (globalThis as Record<string, unknown>).navigator;

    Object.defineProperty(globalThis, 'navigator', {
      value: undefined,
      configurable: true,
    });

    try {
      const client = new BeaconClient({ post: fallbackPost } as never);
      await expect(client.post('https://example.test/ingest', 'payload')).resolves.toEqual({
        ok: true,
        status: 202,
      });
      expect(fallbackPost).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    }
  });
});