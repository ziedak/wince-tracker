import { deserialize, isNumber, isString, serialize } from '@wince/utils';
import type { IHttpClient, IHttpResponse } from './IHttpClient';

export enum WsReceivedEvent {
  Ack = 'Ack',
  /** The WebSocket connection was closed before the server acked the request. */
  // ConnectionClosed = 'ConnectionClosed',
  /** The WebSocket connection was closed before the server acked the request. */
  //   AckTimeout = 'AckTimeout'
}

export interface IWSResponse {
  type: WsReceivedEvent;
  correlationId: string;
  status?: number;
  headers: Record<string, string>;
}
/** Default timeout awaiting a response ack (ms). */
const DEFAULT_ACK_TIMEOUT_MS = 10_000;

/** Reconnect base delay (ms). */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Pending request stored while we wait for the server to ack a sent message.
 */
interface PendingRequest {
  resolve: (res: IHttpResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
export interface WebSocketClientOptions {
  // The WebSocket server URL. Must be a ws:// or wss:// URL.
  url: string;
  /** Timeout awaiting a server ack (ms). Default: 10 000 */
  ackTimeoutMs: number;
  /** Optional subprotocols to pass to the WebSocket constructor. */
  protocols?: string | string[];
}
export const DEFAULT_WS_CLIENT_OPTIONS: WebSocketClientOptions = {
  url: '',
  ackTimeoutMs: DEFAULT_ACK_TIMEOUT_MS
};

/**
 * A WebSocket-based IHttpClient.
 *
 * Maintains a single persistent WebSocket connection. Each `post()` call sends
 * a JSON frame tagged with a correlation ID and waits for an ack before
 * resolving. On connection loss the client auto-reconnects with exponential
 * backoff; pending requests fail with a retry-eligible signal.
 *
 * No external dependencies — uses the native WebSocket API.
 */
export class WebSocketClient implements IHttpClient {
  private readonly _url: string;
  private readonly _ackTimeoutMs: number;
  private readonly _protocols?: string | string[];

  private _ws: WebSocket | null = null;
  private _pending = new Map<string, PendingRequest>();
  private _correlationSeq = 0;
  private _closed = false;

  // Reconnect state
  private _reconnectAttempts = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _openResolve: (() => void) | null = null;
  private _openPromise: Promise<void> | null = null;

  private opts: WebSocketClientOptions;

  constructor(
    opts: WebSocketClientOptions,
    private _fallback: IHttpClient
  ) {
    this.opts = opts;
    this._url = this.opts.url;
    if (!this._url.startsWith('ws://') && !this._url.startsWith('wss://')) {
      throw new Error(`WebSocketClient: invalid URL (must be ws:// or wss://): ${this._url}`);
    }
    this._ackTimeoutMs = this.opts.ackTimeoutMs;
    this._protocols = this.opts.protocols;
  }

  /**
   * Send a message over the WebSocket and wait for a server ack.
   *
   * The body is sent as a JSON frame:
   * ```json
   * {
   *   "type": "event",
   *   "correlationId": "<uuid>",
   *   "headers": { ... },
   *   "payload": "<base64-or-string>",
   *   "binary": true|false
   * }
   * ```
   *
   * The server MUST reply with a frame matching this shape:
   * ```json
   * { "type": "ack", "correlationId": "<same>", "status": 200 }
   * ```
   */
  async post(
    url: string,
    body: Uint8Array | string,
    headers: Record<string, string> = {},
    signal?: AbortSignal
  ): Promise<IHttpResponse> {
    // The `url` argument is ignored — this client owns a fixed WebSocket
    // connection established in the constructor. If the caller wants to post
    // to a different URL they need a separate WebSocketClient instance.

    await this._ensureOpen(signal);
    if (this._closed || !this._ws) {
      return this._fallback.post(url, body, headers, signal);
    }

    const correlationId = `${++this._correlationSeq}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    const frame = {
      type: 'event',
      correlationId,
      headers,
      payload: isString(body) ? body : Array.from(body),
      binary: !isString(body)
    };

    return new Promise<IHttpResponse>((resolve, reject) => {
      // Timeout for the ack
      const timer = setTimeout(() => {
        this._pending.delete(correlationId);
        reject(new Error(`WebSocket ack timeout for ${correlationId}`));
      }, this._ackTimeoutMs);

      // Also abort if the signal fires
      const onAbort = () => {
        this._pending.delete(correlationId);
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      // Wrap resolve/reject to clean up abort listener on settlement
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      const wrappedResolve = (res: IHttpResponse) => {
        cleanup();
        resolve(res);
      };
      const wrappedReject = (err: Error) => {
        cleanup();
        reject(err);
      };

      this._pending.set(correlationId, {
        resolve: wrappedResolve,
        reject: wrappedReject,
        timer
      });

      try {
        this._ws?.send(serialize(frame));
      } catch (err) {
        this._pending.delete(correlationId);
        clearTimeout(timer);
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Gracefully close the WebSocket connection. */
  close(): void {
    this._closed = true;
    this._clearReconnectTimer();
    this._failAllPending(new Error('WebSocketClient closed'));

    if (this._ws) {
      this._ws.onopen = null;
      this._ws.onmessage = null;
      this._ws.onerror = null;
      this._ws.onclose = null;
      this._ws.close();
      this._ws = null;
    }
  }

  // --------------------------------------------------------------------------
  // Connection management
  // --------------------------------------------------------------------------

  private _ensureOpen(signal?: AbortSignal): Promise<void> {
    if (this._ws?.readyState === WebSocket.OPEN) {
      // Reconnection succeeded — connection is healthy
      if (!this._openPromise) return Promise.resolve();
      return this._openPromise;
    }
    if (this._openPromise) return this._openPromise;

    this._openPromise = new Promise<void>((resolve, reject) => {
      this._openResolve = resolve;
      this._connect();

      // Reject if the caller's signal fires before we open
      if (signal) {
        if (signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true
        });
      }
    });

    return this._openPromise;
  }

  private _connect(): void {
    if (this._closed) return;

    // Clean up previous socket if any (e.g. after a failed reconnect)
    if (this._ws) {
      try {
        this._ws.close();
      } catch {
        /* swallow */
      }
    }

    try {
      this._ws = new WebSocket(this._url, this._protocols);
    } catch (err) {
      console.error('WebSocketClient failed to connect:', err);
      this._scheduleReconnect();
      return;
    }

    // Make TypeScript happy — some environments use a different event map
    const ws = this._ws as WebSocket & {
      onopen: ((ev: Event) => void) | null;
      onmessage: ((ev: MessageEvent) => void) | null;
      onerror: ((ev: Event) => void) | null;
      onclose: ((ev: CloseEvent) => void) | null;
    };

    ws.onopen = () => {
      this._reconnectAttempts = 0;
      const resolve = this._openResolve;
      this._openResolve = null;
      this._openPromise = null;
      resolve?.();
    };

    ws.onmessage = (ev: MessageEvent) => {
      this._handleReceivedMessage(ev);
    };

    ws.onerror = () => {
      // onclose will fire right after this, so we handle reconnect there
    };

    ws.onclose = () => {
      if (this._closed) return;

      // Fail all pending requests — they'll be retried by the caller
      this._failAllPending(new Error('WebSocket disconnected'));

      const resolve = this._openResolve;
      this._openResolve = null;
      this._openPromise = null;
      resolve?.(); // unblock any _ensureOpen waiter so they see the closed state

      this._ws = null;
      this._scheduleReconnect();
    };
  }

  private _handleReceivedMessage(ev: MessageEvent): void {
    try {
      const data = isString(ev.data) ? ev.data : new TextDecoder().decode(ev.data);
      const msg = deserialize<IWSResponse>(data) as IWSResponse;
      switch (msg.type) {
        case WsReceivedEvent.Ack: {
          if (!isString(msg.correlationId)) return; // malformed ack
          const pending = this._pending.get(msg.correlationId);
          if (!pending) return; // already handled (e.g. timeout or abort)
          this._pending.delete(msg.correlationId);
          clearTimeout(pending.timer);
          pending.resolve({
            ok: isNumber(msg.status) ? msg.status >= 200 && msg.status < 300 : true,
            status: msg.status ?? 200,
            headers: {
              get: (name: string) => (msg.headers as Record<string, string>)?.[name] ?? null
            },
            body: null
          });
        }
      }
    } catch {
      /* malformed frame — ignore */
    }
  }

  private _scheduleReconnect(): void {
    if (this._closed) return;
    this._clearReconnectTimer();
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this._reconnectAttempts),
      RECONNECT_MAX_MS
    );
    this._reconnectAttempts++;
    this._reconnectTimer = setTimeout(() => this._connect(), delay);
  }

  private _clearReconnectTimer(): void {
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private _failAllPending(err: Error): void {
    for (const [, pending] of this._pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this._pending.clear();
  }
}