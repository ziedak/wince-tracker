import { DEFAULT_RETRY_OPTIONS, type DropReason } from './retry';
import { compressAsync } from '@wince/compress';
import { ExporterOptions } from './exporter';
import { DEFAULT_BATCH_QUEUE_OPTS } from './batchQueue';
import { DEFAULT_TOKEN_BUCKET_OPTIONS } from './rateLimiter';
import { TrackEventPayload } from '@wince/types';

export interface TransportOptions<T extends TrackEventPayload> {
  url: string;
  wsUrl: string;
  headers: HeadersInit;
  exporterOpts: {
    critical: ExporterOptions<T>;
    high: ExporterOptions<T>;
    normal: ExporterOptions<T>;
  };
  compress: {
    enabled: boolean;
  };

  maxBufferSize: number;

  /** Per-request network timeout (ms). Default: 10 000 */
  requestTimeoutMs: number;

  /**
   * Start paused — call `start()` after consent is confirmed.
   * Events enqueued while paused are buffered and sent once start() is called.
   * Default: false
   */
  paused: boolean;

  /**
   * Called when an event is permanently lost or blocked from delivery.
   * `item` is the raw event payload; may be absent for pre-enqueue drops.
   */
  onDropped: (reason: DropReason, item?: T) => void;
  /** Called after each HTTP batch is successfully delivered. */
  onBatchDelivered: (eids: string[]) => void;
}

const SCHEMA_VERSION = 1;

export const DEFAULT_TRANSPORT_OPTIONS: TransportOptions<TrackEventPayload> = {
  url: '',
  wsUrl: '',

  headers: {},
  maxBufferSize: 500,
  requestTimeoutMs: 10_000,
  exporterOpts: {
    critical: {
      schemaVersion: SCHEMA_VERSION,
      rateLimit: DEFAULT_TOKEN_BUCKET_OPTIONS,
      batch: DEFAULT_BATCH_QUEUE_OPTS,
      retry: DEFAULT_RETRY_OPTIONS,
      compressFn: compressAsync,
      onBatchDelivered: () => {
        /* noop */
      }
    },
    high: {
      schemaVersion: SCHEMA_VERSION,
      rateLimit: DEFAULT_TOKEN_BUCKET_OPTIONS,
      batch: DEFAULT_BATCH_QUEUE_OPTS,
      retry: DEFAULT_RETRY_OPTIONS,
      compressFn: compressAsync,
      onBatchDelivered: () => {
        /* noop */
      }
    },
    normal: {
      schemaVersion: SCHEMA_VERSION,
      rateLimit: DEFAULT_TOKEN_BUCKET_OPTIONS,
      batch: DEFAULT_BATCH_QUEUE_OPTS,
      retry: DEFAULT_RETRY_OPTIONS,
      compressFn: compressAsync,
      onBatchDelivered: () => {
        /* noop */
      }
    }
  },
  compress: {
    enabled: true
  },
  paused: false,
  onDropped: () => {
    /* noop */
  },
  onBatchDelivered: () => {
    /* noop */
  }
};
