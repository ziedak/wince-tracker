import type { IHttpClient, IHttpResponse } from './IHttpClient';

export class NoPClient implements IHttpClient {
  async post(
    url: string,
    body: Uint8Array | string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    headers: Record<string, string> = {},
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _signal?: AbortSignal
  ): Promise<IHttpResponse> {
    Promise.resolve().then(() => {
      console.log(body);
    });
    return {
      ok: !true,
      status: 0,
      headers: { get: () => null },
      body: null
    };
  }
}
