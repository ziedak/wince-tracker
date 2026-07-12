/** HTTP response returned by an IHttpClient. */
export interface IHttpResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: { cancel(): Promise<void> } | null;
}

export interface IHttpClient {
  post(
    url: string,
    body: Uint8Array | string,
    headers?: HeadersInit,
    signal?: AbortSignal
  ): Promise<IHttpResponse>;
  close?(): void;
}
