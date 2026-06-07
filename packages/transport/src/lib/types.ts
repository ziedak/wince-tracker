export interface EventPayload {
  [key: string]: unknown;
}

export interface TransportOptions {
  url: string;
  batchSize?: number;
  batchTimeoutMs?: number;
  compress?: boolean;
  headers?: Record<string, string>;
  maxBufferSize?: number;
  /** Per-request network timeout (ms). Default: 10 000 */
  requestTimeoutMs?: number;
  /**
   * Start paused — call `start()` after consent is confirmed.
   * Events enqueued while paused are buffered and sent once start() is called.
   * Default: false
   */
  paused?: boolean;
  /** Injectable fetch for testing */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  client?: import('./httpClient').HTTPClient;
  retry?: {
    attempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    factor?: number;
    jitter?: boolean;
  };
}

