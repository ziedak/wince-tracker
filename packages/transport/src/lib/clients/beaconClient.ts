import type { IHttpClient, IHttpResponse } from './IHttpClient';

export class BeaconClient implements IHttpClient {
  constructor(private fallback?: IHttpClient) {}

  async post(
    url: string,
    body: Uint8Array | string,
    headers: Record<string, string> = {},
    _signal?: AbortSignal
  ): Promise<IHttpResponse> {
    if (
      typeof navigator !== 'undefined' &&
      typeof (navigator as Navigator).sendBeacon === 'function'
    ) {
      try {
        let payload: Blob | string;
        if (typeof body === 'string') payload = body;
        else payload = new Blob([body as BlobPart]);
        const ok = (navigator as Navigator).sendBeacon(url, payload);
        return {
          ok: !!ok,
          status: ok ? 200 : 0,
          headers: { get: () => null },
          body: null
        };
      } catch {
        if (this.fallback) {
          return this.fallback.post(url, body, headers, _signal);
        }
        throw new Error('BeaconClient: sendBeacon failed and no fallback client is available.');
      }
    }
    if (this.fallback) {
      return this.fallback.post(url, body, headers, _signal);
    }
    throw new Error(
      'BeaconClient: sendBeacon is not available and no fallback client is provided.'
    );
  }
}
