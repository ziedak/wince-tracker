import { withRetries } from './retry';

export class Batcher<T> {
  private queue: T[] = [];
  private timer: any = null;

  constructor(
    private sendFn: (batch: T[]) => Promise<void>,
    private opts: { batchSize?: number; batchTimeoutMs?: number; retryAttempts?: number; retryOpts?: any } = {},
  ) {}

  add(item: T) {
    this.queue.push(item);
    if (this.queue.length >= (this.opts.batchSize ?? 10)) {
      void this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        void this.flush();
      }, this.opts.batchTimeoutMs ?? 1000);
    }
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    await withRetries(() => this.sendFn(batch), this.opts.retryAttempts ?? 3, undefined, this.opts.retryOpts);
  }
}
