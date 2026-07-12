import { safeSetTimeout } from './safeSetTimeout';
import { classifyStatus, type SendOutcome } from './sendOutcome';
import type { IHttpClient } from './clients/IHttpClient';

export interface HttpSenderOptions {
  /** OTLP/HTTP or batch endpoint URL */
  endpoint: string;
  /** Default headers merged with per-request headers */
  headers?: HeadersInit;
  /** Hard timeout per request (ms). Triggers AbortController. Default: 10 000 */
  requestTimeoutMs?: number;
}

export class HttpSender {
  private readonly _endpoint: string;
  private readonly _headers: HeadersInit;
  private readonly _requestTimeoutMs: number;
  private readonly _client: IHttpClient;

  constructor(client: IHttpClient, opts: HttpSenderOptions) {
    this._endpoint = opts.endpoint;
    this._headers = { 'Content-Type': 'application/json', ...opts.headers };
    this._requestTimeoutMs = opts.requestTimeoutMs ?? 10_000;
    this._client = client;
  }

  /**
   * Send a pre-serialised body. Never throws — always returns a SendOutcome.
   * The AbortController timeout uses safeSetTimeout so it doesn't keep Node.js alive.
   */
  async send(body: string | Uint8Array, extraHeaders?: HeadersInit): Promise<SendOutcome> {
    const ctrl = new AbortController();
    const timer = safeSetTimeout(() => ctrl.abort(), this._requestTimeoutMs);

    let res: {
      ok: boolean;
      status: number;
      headers: { get(name: string): string | null };
      body: { cancel(): Promise<void> } | null;
    };
    try {
      res = await this._client.post(
        this._endpoint,
        body,
        { ...this._headers, ...extraHeaders },
        ctrl.signal
      );
    } catch {
      clearTimeout(timer);
      // Network error or AbortError (timeout) — treat as transient, keep records
      return { kind: 'retry' };
    }

    clearTimeout(timer);

    const outcome = classifyStatus(res.status);

    // Respect Retry-After header on 429 / 503
    if (outcome.kind === 'retry' && (res.status === 429 || res.status === 503)) {
      const ra = res.headers.get('Retry-After');
      if (ra !== null) {
        const secs = Number(ra);
        const retryAfterMs =
          Number.isFinite(secs) && secs > 0 ? secs * 1000 : Date.parse(ra) - Date.now();
        if (retryAfterMs > 0) {
          return { kind: 'retry', retryAfterMs };
        }
      }
    }

    // Drain body to prevent keep-alive issues (e.g. Cloudflare Workers)
    try {
      await res.body?.cancel();
    } catch {
      /* best-effort */
    }

    return outcome;
  }
}
