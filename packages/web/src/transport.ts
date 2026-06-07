import Transport from '@wince/transport';
import { BeaconClient } from '@wince/transport';
import type { TransportOptions } from '@wince/transport';

/**
 * Create a default Transport instance for browser usage.
 * Uses BeaconClient with a Fetch fallback and enables compression by default.
 */
export function createDefaultTransport(url: string, opts?: Partial<TransportOptions>) {
  const client = new BeaconClient();
  const transport = new Transport({
    url,
    compress: opts?.compress ?? true,
    client,
    batchSize: opts?.batchSize,
    batchTimeoutMs: opts?.batchTimeoutMs,
    headers: opts?.headers,
    retry: opts?.retry,
  } as TransportOptions);
  return transport;
}

export default createDefaultTransport;
