export interface HTTPClient {
  post(
    url: string,
    body: Uint8Array | string,
    headers?: Record<string, string>,
  ): Promise<{ ok: boolean; status: number }>;
}
