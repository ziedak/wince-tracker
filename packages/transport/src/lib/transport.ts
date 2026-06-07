import type { EventPayload, TransportOptions } from './types';
import type { HTTPClient } from './httpClient';
import { FetchClient } from './fetchClient';
import { Batcher } from './batcher';
import compress from '@wince/compress';

export class Transport {
  private client: HTTPClient;
  private batcher: Batcher<EventPayload>;
  private url: string;
  private compressPayload: boolean;

  constructor(opts: TransportOptions) {
    this.url = opts.url;
    this.client = opts.client ?? new FetchClient(opts.headers ?? {});
    this.compressPayload = Boolean(opts.compress);
    this.batcher = new Batcher<EventPayload>(async (batch) => await this.sendBatch(batch), {
      batchSize: opts.batchSize ?? 10,
      batchTimeoutMs: opts.batchTimeoutMs ?? 1000,
      retryAttempts: opts.retry?.attempts ?? 3,
      retryOpts: opts.retry,
    });
  }

  send(event: EventPayload) {
    this.batcher.add(event);
  }

  async flush() {
    await this.batcher.flush();
  }

  private async sendBatch(batch: EventPayload[]) {
    let body: Uint8Array | string;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const payloadStr = JSON.stringify(batch);
    if (this.compressPayload) {
      body = await compress(payloadStr);
      headers['Content-Encoding'] = 'gzip';
    } else {
      body = payloadStr;
    }
    await this.client.post(this.url, body, headers);
  }
}

export default Transport;
export function transport(): string {
  return 'transport';
}
