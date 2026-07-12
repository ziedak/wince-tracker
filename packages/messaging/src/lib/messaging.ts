import type { IHttpClient } from '@wince/transport';
import { WebSocketClient, HttpClient, type ServerPushedCommand } from '@wince/transport';
import { deserialize, isString } from '@wince/utils';

/**
 * Base command sent from backend to tracker.
 * Extend this for specific intervention types.
 */
export interface ServerCommand {
  type: string;
  payload: unknown;
  requestId: string;
}

export interface MessagingOptions {
  /** WebSocket URL for primary push channel (ws:// or wss://) */
  wsUrl: string;
  /** HTTP URL for fallback polling when WS is unavailable */
  httpUrl: string;
  headers?: Record<string, string>;
  /** Timeout for WS ack and HTTP requests (ms). Default: 10_000 */
  requestTimeoutMs?: number;
  /** Called when a command is received from the server (WS or HTTP) */
  onCommand: (cmd: ServerCommand) => void | Promise<void>;
  /** Optional fallback client (e.g. BeaconClient) for HTTP path */
  fallback?: IHttpClient;
  /** Poll interval for HTTP fallback when WS is unavailable (ms). Default: 30_000 */
  pollIntervalMs?: number;
  /** Max number of processed requestIds to keep for deduplication. Default: 1000 */
  maxDeduplicationEntries?: number;
}

export const DEFAULT_MESSAGING_OPTIONS = {
  requestTimeoutMs: 10_000,
  pollIntervalMs: 30_000,
  maxDeduplicationEntries: 1000,
  headers: {} as Record<string, string>,
  onCommand: async () => {
    /* noop */
  }
};

/**
 * Bidirectional messaging client for server→tracker command delivery.
 *
 * Primary channel: WebSocket (server pushes commands in real-time)
 * Fallback channel: HTTP long-poll (polls `/commands` endpoint when WS is down)
 *
 * @example
 * ```ts
 * const messaging = new MessagingClient({
 *   wsUrl: 'wss://api.example.com/ws',
 *   httpUrl: 'https://api.example.com/commands/poll',
 *   onCommand: (cmd) => registry.execute(cmd),
 * });
 * messaging.start();
 * ```
 */
export class MessagingClient {
  private readonly _wsClient: WebSocketClient;
  private readonly _httpClient: HttpClient;
  private readonly _httpUrl: string;
  private readonly _headers: Record<string, string>;
  private readonly _onCommand: (cmd: ServerCommand) => void | Promise<void>;
  private readonly _pollIntervalMs: number;
  private readonly _requestTimeoutMs: number;
  private readonly _maxDeduplicationEntries: number;

  /** WS connection state — true only when WebSocket is connected */
  private _wsConnected = false;
  /** HTTP poll state — true when last HTTP poll succeeded */
  private _httpConnected = false;
  private _pollTimer: ReturnType<typeof setTimeout> | null = null;
  private _polling = false;
  private _started = false;

  /** Deduplication: tracks processed requestIds to prevent duplicate execution */
  private _processedRequestIds = new Set<string>();
  /** FIFO queue for deduplication entries (to enforce max size) */
  private _deduplicationQueue: string[] = [];

  constructor(opts: MessagingOptions) {
    this._httpUrl = opts.httpUrl;
    this._headers = opts.headers ?? DEFAULT_MESSAGING_OPTIONS.headers;
    this._onCommand = opts.onCommand;
    this._pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_MESSAGING_OPTIONS.pollIntervalMs;
    this._requestTimeoutMs =
      opts.requestTimeoutMs ?? DEFAULT_MESSAGING_OPTIONS.requestTimeoutMs;
    this._maxDeduplicationEntries =
      opts.maxDeduplicationEntries ?? DEFAULT_MESSAGING_OPTIONS.maxDeduplicationEntries;

    // Build HTTP fallback chain: HttpClient → optional beacon
    this._httpClient = new HttpClient(this._headers, opts.fallback);

    // WS client with HTTP fallback for event delivery
    this._wsClient = new WebSocketClient(
      {
        url: opts.wsUrl,
        ackTimeoutMs: this._requestTimeoutMs
      },
      this._httpClient
    );

    // Register WS command listener — server pushes commands via WS frames
    this._wsClient.onCommand((cmd: ServerPushedCommand) => {
      void this._dispatchCommand({
        type: cmd.type,
        payload: cmd.payload,
        requestId: cmd.requestId
      });
    });
  }

  /**
   * Start the messaging client.
   * Attempts WS connection first; starts HTTP polling as fallback.
   */
  start(): void {
    if (this._started) return;
    this._started = true;

    // Try WS connection — if it succeeds, server can push commands directly.
    // If it fails, HTTP polling starts automatically.
    const tryWsConnect = async () => {
      try {
        // Send a no-op to trigger WS connection
        const res = await this._wsClient.post('', new Uint8Array(), this._headers);
        if (res.ok) {
          this._wsConnected = true;
          // WS connected — stop HTTP polling (optimization #8)
          this._stopPolling();
        }
      } catch {
        this._wsConnected = false;
        // WS failed — ensure HTTP polling is running
        if (!this._pollTimer) {
          this._startPolling();
        }
      }
    };

    void tryWsConnect();

    // Start HTTP polling as fallback (will be stopped if WS connects)
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
    this._deduplicationQueue.length = 0;
  }

  /**
   * Whether the WS connection is currently active.
   * Returns true only when WebSocket is connected (not when only HTTP polling works).
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

  /**
   * Send an acknowledgement back to the server that a command was received.
   * This helps the server track which interventions were delivered.
   * Uses WS when connected, falls back to HTTP otherwise.
   */
  async ack(requestId: string): Promise<void> {
    // Skip WS if not connected — go straight to HTTP (optimization #7)
    if (this._wsConnected) {
      try {
        const body = JSON.stringify({ type: 'command_ack', requestId });
        await this._wsClient.post('', body, this._headers);
        return;
      } catch {
        // WS failed — fall through to HTTP
        this._wsConnected = false;
        // Resume polling since WS is down
        if (this._started && !this._pollTimer) {
          this._startPolling();
        }
      }
    }

    // HTTP fallback for ack
    try {
      await this._httpClient.post(
        `${this._httpUrl}/ack`,
        JSON.stringify({ requestId }),
        { 'Content-Type': 'application/json', ...this._headers }
      );
    } catch {
      // Ack failed — server will retry the command on next poll
    }
  }

  // --------------------------------------------------------------------------
  // Internal: command dispatch with deduplication
  // --------------------------------------------------------------------------

  private async _dispatchCommand(cmd: ServerCommand): Promise<void> {
    // Deduplication: skip if we've already processed this requestId (bug #4)
    if (this._isDuplicate(cmd.requestId)) {
      return;
    }
    this._markProcessed(cmd.requestId);

    try {
      await this._onCommand(cmd);
    } catch (err) {
      console.error('[MessagingClient] onCommand handler error:', err);
    }
  }

  /** Check if a requestId has already been processed */
  private _isDuplicate(requestId: string): boolean {
    return this._processedRequestIds.has(requestId);
  }

  /** Mark a requestId as processed, enforcing max deduplication entries */
  private _markProcessed(requestId: string): void {
    this._processedRequestIds.add(requestId);
    this._deduplicationQueue.push(requestId);

    // Enforce max size — remove oldest entries (FIFO eviction)
    while (this._deduplicationQueue.length > this._maxDeduplicationEntries) {
      const oldest = this._deduplicationQueue.shift();
      if (oldest !== undefined) {
        this._processedRequestIds.delete(oldest);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Internal: HTTP fallback polling
  // --------------------------------------------------------------------------

  private _startPolling(): void {
    this._stopPolling();
    // Use recursive setTimeout instead of setInterval (optimization #6)
    // This ensures we don't queue up polls if one takes longer than the interval
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
    if (this._polling) return; // prevent overlapping polls
    this._polling = true;

    try {
      const res = await this._httpClient.post(
        this._httpUrl,
        JSON.stringify({ type: 'poll' }),
        { 'Content-Type': 'application/json', ...this._headers }
      );

      if (res.ok && res.body) {
        // Parse commands from response body
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

        // Mark HTTP as connected (separate from WS state — bug #3)
        this._httpConnected = true;
      } else {
        this._httpConnected = false;
      }
    } catch {
      // Poll failed — mark HTTP as disconnected
      // Don't touch _wsConnected — WS state is independent (bug #3)
      this._httpConnected = false;
    } finally {
      this._polling = false;
    }
  }
}