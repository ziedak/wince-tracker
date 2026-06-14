import { FetchClient } from './fetchClient';

describe('FetchClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('merges default and per-call headers and enables keepalive for small bodies', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    const originalFetch = global.fetch;
    global.fetch = fetchMock as typeof fetch;

    try {
      const client = new FetchClient({ 'X-Default': '1' });
      await client.post('https://example.test/ingest', 'hello', { 'X-Request': '2' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][1]).toMatchObject({
        method: 'POST',
        headers: { 'X-Default': '1', 'X-Request': '2' },
        keepalive: true,
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('disables keepalive when the body reaches the browser limit', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const originalFetch = global.fetch;
    global.fetch = fetchMock as typeof fetch;

    try {
      const client = new FetchClient();
      await client.post('https://example.test/ingest', 'x'.repeat(51_200));

      expect(fetchMock.mock.calls[0][1]).toMatchObject({ keepalive: false });
    } finally {
      global.fetch = originalFetch;
    }
  });
});