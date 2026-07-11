import type { IHttpClient } from './IHttpClient';

/** Browser keepalive limit — bodies at or above this size disable keepalive. */
const KEEPALIVE_BYTE_LIMIT = 51_200; // 50 KB (browser cap is ~64 KB total including headers)

export class HttpClient implements IHttpClient {
  constructor(private defaultHeaders: Record<string, string> = {}) {}

  async post(
    url: string,
    body: Uint8Array | string,
    headers: Record<string, string> = {}
  ): Promise<{ ok: boolean; status: number }> {
    const finalHeaders = { ...this.defaultHeaders, ...headers };
    const bodySize = typeof body === 'string' ? body.length : body.byteLength;
    const res = await fetch(url, {
      method: 'POST',
      headers: finalHeaders as HeadersInit,
      body: body as BodyInit,
      keepalive: bodySize < KEEPALIVE_BYTE_LIMIT
    });
    return { ok: res.ok, status: res.status };
  }
}
