import { isString } from '@wince/utils';
import type { IHttpClient, IHttpResponse } from './IHttpClient';

/** Browser keepalive limit — bodies at or above this size disable keepalive. */
const KEEPALIVE_BYTE_LIMIT = 51_200; // 50 KB (browser cap is ~64 KB total including headers)

export class HttpClient implements IHttpClient {
  constructor(
    private defaultHeaders: HeadersInit = {},
    private _fallback: IHttpClient
  ) {}

  async post(
    url: string,
    body: Uint8Array | string,
    headers: HeadersInit = {},
    signal?: AbortSignal
  ): Promise<IHttpResponse> {
    const finalHeaders = { ...this.defaultHeaders, ...headers };
    const bodySize = isString(body) ? body.length : body.byteLength;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: finalHeaders,
        body: body as BodyInit,
        keepalive: bodySize < KEEPALIVE_BYTE_LIMIT,
        signal
      });

      return {
        ok: res.ok,
        status: res.status,
        headers: res.headers,
        body: res.body
      };
    } catch {
      // Network error (fetch threw) — fallback to the provided client (e.g. sendBeacon)
      if (this._fallback) {
        return this._fallback.post(url, body, finalHeaders, signal);
      }
      throw new Error('HttpClient: fetch failed and no fallback client is available.');
    }
  }
}
