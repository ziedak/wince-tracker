import { WebSocketClient, HttpClient, type ServerPushedCommand, NoPClient } from '@wince/transport';
import { deserialize, isString } from '@wince/utils';
import type { ILRUCache } from '@wince/types';
import { LRUCache, LRUCacheOptions } from '@wince/cache';

/**
 * Base command sent from backend to tracker.
 * Extend this for specific intervention types.
 */
export interface ServerCommand {
  type: string;
  payload: unknown;
  requestId: string;
  /** When present, this is a response to a previous request with this ID. */
  responseTo?: string;
}

export interface MessagingOptions {
  /** WebSocket URL for primary push channel (ws:// or wss://) */
  wsUrl: string;
  /** HTTP URL for fallback when WS is unavailable */
  httpUrl: string;
  headers: HeadersInit;
  /** Timeout for WS ack and HTTP requests (ms). Default: 10_000 */
  requestTimeoutMs: number;
  /** Poll interval for HTTP fallback when WS is unavailable (ms). Default: 30_000 */
  pollIntervalMs: number;
  /** Max number of processed requestIds to keep for deduplication. Default: 1000 */
  lRUCacheOptions: LRUCacheOptions;
}

export const DEFAULT_MESSAGING_OPTIONS: MessagingOptions = {
  requestTimeoutMs: 10000,
  pollIntervalMs: 30000,
  headers: {},
  wsUrl: '',
  httpUrl: '',
  lRUCacheOptions: {
    maxSize: 1000,
    ttlMs: 60 * 60 * 1000
  }
};

/**
 * Bidirectional messaging client for server↔tracker communication.
 *
 * Two primitives:
 * - `send(msg)` — send anything to the server (WS primary, HTTP fallback)
 * - `onCommand(handler)` — receive anything from the server
 *
 * Everything else (hello handshake, request-response, identify routing)
 * is built on top of these two primitives by the application layer.
 *
 * @example
 * ```ts
 * const messaging = new MessagingClient({
 *   wsUrl: 'wss://api.example.com/ws',
 *   httpUrl: 'https://api.example.com/commands',
 * });
 *
 * // Receive commands from server
 * messaging.onCommand((cmd) => {
 *   if (cmd.type === 'identify') {
 *     client.handleServerIdentify(cmd.payload.uid, cmd.payload.personProps);
 *   }
 * });
 *
 * // Send a message to the server
 * messaging.send({ type: 'hello', payload: { anon: '...' }, requestId: '...' });
 *
 * messaging.start();
 * ```
 */
export class MessagingClient {
  private readonly _wsClient: WebSocketClient;
  private readonly _httpClient: HttpClient;
  private readonly _httpUrl: string;
  private readonly _headers: HeadersInit;
  private readonly _pollIntervalMs: number;
  private readonly _requestTimeoutMs: number;

  /** WS connection state — true only when WebSocket is connected */
  private _wsConnected = false;
  /** HTTP poll state — true when last HTTP poll succeeded */
  private _httpConnected = false;
  private _pollTimer: ReturnType<typeof setTimeout> | null = null;
  private _polling = false;
  private _started = false;

  /** Deduplication: tracks processed requestIds to prevent duplicate execution */
  private _processedRequestIds: ILRUCache;

  /** Command handlers registered via onCommand() */
  private _handlers: Array<(cmd: ServerCommand) => void | Promise<void>> = [];

  /** Pending request() calls awaiting a responseTo match */
  private _pendingRequests = new Map<string, {
    resolve: (cmd: ServerCommand) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(opts: Partial<MessagingOptions>) {
    const mergedOpts = { ...DEFAULT_MESSAGING_OPTIONS, ...opts };
    this._httpUrl = mergedOpts.httpUrl;
    this._headers = mergedOpts.headers;
    this._pollIntervalMs = mergedOpts.pollIntervalMs;
    this._requestTimeoutMs = mergedOpts.requestTimeoutMs;

    this._processedRequestIds = new LRUCache(mergedOpts.lRUCacheOptions);
    // Build HTTP fallback chain: HttpClient → NoPClient (no-op fallback)
    this._httpClient = new HttpClient(this._headers, new NoPClient());

    // WS client with HTTP fallback for event delivery
    this._wsClient = new WebSocketClient(
      {
        url: mergedOpts.wsUrl,
        ackTimeoutMs: this._requestTimeoutMs
      },
      this._httpClient
    );

    // Register WS command listener — server pushes commands via WS frames
    this._wsClient.onCommand((cmd: ServerPushedCommand) => {
      void this._dispatchCommand({
        type: cmd.type,
        payload: cmd.payload,
        requestId: cmd.requestId,
      });
    });
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Start the messaging client.
   * Attempts WS connection first; starts HTTP polling as fallback.
   */
  start(): void {
    if (this._started) return;
    this._started = true;

    // Try WS connection
    const tryWsConnect = async () => {
      try {
        // Send a no-op to trigger WS connection
        const res = await this._wsClient.post('', new Uint8Array(), this._headers);
        if (res.ok) {
          this._wsConnected = true;
          this._stopPolling();
        }
      } catch {
        this._wsConnected = false;
        if (!this._pollTimer) {
          this._startPolling();
        }
      }
    };

    void tryWsConnect();

    // Start HTTP polling as fallback
    this._startPolling();
  }

  /** Stop the messaging client and clean up resources. */
  stop(): void {
    this._started = false;
    this._wsClient.close();
    this._stopPolling();
    this._wsConnected = false;
    this._httpConnected = false;
    this._processedRequestIds.clear();
    this._handlers = [];
  }

  /**
   * Send a message to the server.
   *
   * Primary channel: WebSocket (when connected)
   * Fallback channel: HTTP POST to httpUrl
   *
   * @example
   * ```ts
   * messaging.send({ type: 'hello', payload: { anon: '...' }, requestId: 'req-1' });
   * messaging.send({ type: 'command_ack', requestId: 'cmd-1' });
   * ```
   */
  send(msg: unknown): void {
    const body = JSON.stringify(msg);

    if (this._wsConnected) {
      // WS primary — fire-and-forget via post (which uses WS send internally)
      void this._wsClient.post('', body, this._headers).catch(() => {
        this._wsConnected = false;
        // Resume polling since WS is down
        if (this._started && !this._pollTimer) {
          this._startPolling();
        }
        // Retry via HTTP
        this._sendHttp(body);
      });
    } else {
      this._sendHttp(body);
    }
  }

  /**
   * Register a handler for incoming commands from the server.
   * Multiple handlers can be registered; all are called in registration order.
   * Deduplication by requestId is applied before handlers are invoked.
   *
   * @returns An unsubscribe function.
   *
   * @example
   * ```ts
   * const unsub = messaging.onCommand((cmd) => {
   *   if (cmd.type === 'identify') {
   *     client.handleServerIdentify(cmd.payload.uid, cmd.payload.personProps);
   *   }
   * });
   * // later: unsub();
   * ```
   */
  onCommand(handler: (cmd: ServerCommand) => void | Promise<void>): () => void {
    this._handlers.push(handler);
    return () => {
      this._handlers = this._handlers.filter((h) => h !== handler);
    };
  }

  /**
   * Send a request to the server and await a response.
   *
   * This is a convenience wrapper around `send()` + `onCommand()`:
   * it generates a `requestId`, sends the message, and resolves when
   * a command with `responseTo === requestId` arrives.
   *
   * Falls back to HTTP POST when WS is unavailable (the HTTP response
   * body is parsed as a `ServerCommand` with `responseTo`).
   *
   * @example
   * ```ts
   * const res = await messaging.request('enrich', { anon: 'abc', session: 'xyz' });
   * console.log(res.payload); // { uid: 'user-123', $set: { tier: 'gold' } }
   * ```
   */
  async request(
    type: string,
    payload: unknown,
    timeoutMs: number = this._requestTimeoutMs,
  ): Promise<ServerCommand> {
    const requestId = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<ServerCommand>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        this._pendingRequests.delete(requestId);
        reject(new Error(`[MessagingClient] request "${type}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const unsub = this.onCommand((cmd) => {
        if (cmd.responseTo === requestId) {
          clearTimeout(timer);
          unsub();
          this._pendingRequests.delete(requestId);
          resolve(cmd);
        }
      });

      this._pendingRequests.set(requestId, { resolve, reject, timer });
      this.send({ type, payload, requestId });
    });
  }

  /**
   * Whether the WS connection is currently active.
   */
  get connected(): boolean {
    return this._wsConnected;
  }

  /**
   * Whether any channel (WS or HTTP) is currently connected.
   */
  get anyConnected(): boolean {
    return this._wsConnected || this._httpConnected;
  }

  // --------------------------------------------------------------------------
  // Internal: send via HTTP
  // --------------------------------------------------------------------------

  private _sendHttp(body: string): void {
    void this._httpClient.post(this._httpUrl, body, {
      'Content-Type': 'application/json',
      ...this._headers,
    }).catch(() => {
      // Send failed — best-effort
    });
  }

  // --------------------------------------------------------------------------
  // Internal: command dispatch with deduplication
  // --------------------------------------------------------------------------

  private async _dispatchCommand(cmd: ServerCommand): Promise<void> {
    // Deduplication: skip if we've already processed this requestId
    if (this._isDuplicate(cmd.requestId)) {
      return;
    }
    this._markProcessed(cmd);

    for (const handler of this._handlers) {
      try {
        await handler(cmd);
      } catch (err) {
        console.error('[MessagingClient] handler error:', err);
      }
    }
  }

  private _isDuplicate(requestId: string): boolean {
    return this._processedRequestIds.has(requestId);
  }

  private _markProcessed(cmd: ServerCommand): void {
    this._processedRequestIds.set(cmd.requestId, cmd);
  }

  // --------------------------------------------------------------------------
  // Internal: HTTP fallback polling
  // --------------------------------------------------------------------------

  private _startPolling(): void {
    this._stopPolling();
    const scheduleNext = () => {
      if (!this._started) return;
      this._pollTimer = setTimeout(() => {
        this._pollForCommands().finally(() => {
          if (this._started && !this._wsConnected) {
            scheduleNext();
          }
        });
      }, this._pollIntervalMs);
    };
    // Fire immediately on start
    this._pollForCommands().finally(() => {
      if (this._started && !this._wsConnected) {
        scheduleNext();
      }
    });
  }

  private _stopPolling(): void {
    if (this._pollTimer !== null) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  }

  private async _pollForCommands(): Promise<void> {
    if (this._polling) return;
    this._polling = true;

    try {
      const res = await this._httpClient.post(this._httpUrl, JSON.stringify({ type: 'poll' }), {
        'Content-Type': 'application/json',
        ...this._headers
      });

      if (res.ok && res.body) {
        const bodyText = isString(res.body)
          ? res.body
          : new TextDecoder().decode(res.body as unknown as Uint8Array);

        const parsed = deserialize<{ commands?: ServerCommand[] }>(bodyText);

        if (parsed && typeof parsed === 'object' && 'commands' in parsed) {
          const commands = (parsed as { commands?: ServerCommand[] }).commands;
          if (commands && Array.isArray(commands)) {
            for (const cmd of commands) {
              void this._dispatchCommand(cmd);
            }
          }
        }

        this._httpConnected = true;
      } else {
        this._httpConnected = false;
      }
    } catch {
      this._httpConnected = false;
    } finally {
      this._polling = false;
    }
  }
}