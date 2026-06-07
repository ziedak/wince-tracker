import type { HTTPClient } from './httpClient';

export class FetchClient implements HTTPClient {
  constructor(private defaultHeaders: Record<string, string> = {}) {}

  async post(
    url: string,
    body: Uint8Array | string,
    headers: Record<string, string> = {},
  ): Promise<{ ok: boolean; status: number }> {
    const finalHeaders = { ...this.defaultHeaders, ...headers };
    const res = await fetch(url, {
      method: 'POST',
      headers: finalHeaders as any,
      body: body as any,
      keepalive: true,
    } as any);
    return { ok: !!(res && (res as any).ok), status: (res as any).status || 0 };
  }
}
