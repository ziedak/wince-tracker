export interface EventPayload {
  [key: string]: unknown;
}

/**
 * Reasons an event or batch can be permanently dropped (or blocked from delivery).
 * Surfaced via the `onEventDropped` callback in WinceConfig.
 */
export type DropReason =
  | 'consent'       // consent not granted
  | 'sampling'      // sampler rejected the event
  | 'rate_limit'    // token bucket exhausted
  | 'quota'         // server 429 quota signal
  | 'too_large'     // single event exceeds server size limit
  | 'buffer_full'   // maxBufferSize exceeded — oldest event evicted
  | 'client_dedup'; // identical event fired again within the dedup TTL window

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
  /**
   * Called when an event is permanently lost or blocked from delivery.
   * `item` is the raw event payload; may be absent for pre-enqueue drops.
   */
  onDropped?: (reason: DropReason, item?: EventPayload) => void;
  /** Called after each HTTP batch is successfully delivered. */
  onBatchDelivered?: (eids: string[]) => void;
}

