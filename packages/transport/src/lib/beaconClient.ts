import { IHttpClient } from './IHttpClient';

export class BeaconClient implements IHttpClient {
  constructor(private fallback: IHttpClient) {}

  async post(
    url: string,
    body: Uint8Array | string,
    headers: Record<string, string> = {}
  ): Promise<{ ok: boolean; status: number }> {
    if (typeof navigator !== 'undefined' && typeof (navigator as Navigator).sendBeacon === 'function') {
      try {
        let payload: Blob | string;
        if (typeof body === 'string') payload = body;
        else payload = new Blob([body as BlobPart]);
        const ok = (navigator as Navigator).sendBeacon(url, payload);
        return { ok: !!ok, status: ok ? 200 : 0 };
      } catch {
        return this.fallback.post(url, body, headers);
      }
    }
    return this.fallback.post(url, body, headers);
  }
}
