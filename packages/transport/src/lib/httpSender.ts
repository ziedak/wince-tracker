import { safeSetTimeout } from './safeSetTimeout';
import { classifyStatus, type SendOutcome } from './sendOutcome';

export interface HttpSenderOptions {
  /** OTLP/HTTP or batch endpoint URL */
  endpoint: string;
  /** Default headers merged with per-request headers */
  headers?: Record<string, string>;
  /** Hard timeout per request (ms). Triggers AbortController. Default: 10 000 */
  requestTimeoutMs?: number;
  /** Injectable fetch for testing */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export class HttpSender {
  private readonly _endpoint:         string;
  private readonly _headers:          Record<string, string>;
  private readonly _requestTimeoutMs: number;
  private readonly _fetchFn:          FetchFn;

  constructor(opts: HttpSenderOptions) {
    this._endpoint         = opts.endpoint;
    this._headers          = { 'Content-Type': 'application/json', ...opts.headers };
    this._requestTimeoutMs = opts.requestTimeoutMs ?? 10_000;
    this._fetchFn          = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
  }

  /**
   * Send a pre-serialised body. Never throws — always returns a SendOutcome.
   * The AbortController timeout uses safeSetTimeout so it doesn't keep Node.js alive.
   */
  async send(
    body: string | Uint8Array,
    extraHeaders?: Record<string, string>,
  ): Promise<SendOutcome> {
    const ctrl  = new AbortController();
    const timer = safeSetTimeout(() => ctrl.abort(), this._requestTimeoutMs);

    let res: Response;
    try {
      res = await this._fetchFn(this._endpoint, {
        method:  'POST',
        headers: { ...this._headers, ...extraHeaders } as Record<string, string>,
        body:    body as BodyInit,
        signal:  ctrl.signal,
      });
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
        const retryAfterMs = Number.isFinite(secs) && secs > 0
          ? secs * 1000
          : Date.parse(ra) - Date.now();
        if (retryAfterMs > 0) {
          return { kind: 'retry', retryAfterMs };
        }
      }
    }

    // Drain body to prevent keep-alive issues (e.g. Cloudflare Workers)
    try { await res.body?.cancel(); } catch { /* best-effort */ }

    return outcome;
  }
}
