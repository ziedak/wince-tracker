import type { HTTPClient } from './httpClient';
import { FetchClient } from './fetchClient';

export class BeaconClient implements HTTPClient {
  private fallback: FetchClient;

  constructor(fallback?: FetchClient) {
    this.fallback = fallback || new FetchClient();
  }

  async post(
    url: string,
    body: Uint8Array | string,
    headers: Record<string, string> = {},
  ): Promise<{ ok: boolean; status: number }> {
    if (typeof navigator !== 'undefined' && typeof (navigator as any).sendBeacon === 'function') {
      try {
        let payload: any;
        if (typeof body === 'string') payload = body;
        else payload = new Blob([body as BlobPart]);
        const ok = (navigator as any).sendBeacon(url, payload);
        return { ok: !!ok, status: ok ? 200 : 0 };
      } catch (e) {
        return this.fallback.post(url, body, headers);
      }
    }
    return this.fallback.post(url, body, headers);
  }
}
