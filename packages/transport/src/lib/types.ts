export interface EventPayload {
  event: string;
  timestamp?: string | number;
  [key: string]: any;
}

export interface TransportOptions {
  url: string;
  batchSize?: number;
  batchTimeoutMs?: number;
  compress?: boolean;
  headers?: Record<string, string>;
  client?: import('./httpClient').HTTPClient;
  retry?: {
    attempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    factor?: number;
    jitter?: boolean;
  };
}
