export type DropReason =
  | 'consent' // consent not granted
  | 'sampling' // sampler rejected the event
  | 'rate_limit' // token bucket exhausted
  | 'quota' // server 429 quota signal
  | 'too_large' // single event exceeds server size limit
  | 'buffer_full' // maxBufferSize exceeded — oldest event evicted
  | 'client_dedup';

export interface DelayOptions {
  baseDelayMs: number;
  maxDelayMs: number;
  factor: number;
  jitter: boolean;
}

export const DEFAULT_DELAY_OPTIONS: DelayOptions = {
  baseDelayMs: 200,
  maxDelayMs: 30_000,
  factor: 2,
  jitter: true
};

export function backoffDelay(attempt: number, delayOpts?: Partial<DelayOptions>): number {
  const { baseDelayMs, factor, maxDelayMs, jitter } = { ...DEFAULT_DELAY_OPTIONS, ...delayOpts };
  const delay = Math.min(maxDelayMs, Math.round(baseDelayMs * Math.pow(factor, attempt)));
  if (!jitter) return delay;
  const rand = Math.random();
  return Math.round(delay * (0.5 + rand / 2));
}

export interface WithRetriesOptions {
  /** Number of total attempts (including the first). Default: 3 */
  maxAttempts: number;
  /** Backoff delay options. Default: { baseDelayMs: 200, maxDelayMs: 30000, factor: 2, jitter: true } */
  delayOpts: DelayOptions;
  /** Return false to stop retrying immediately and rethrow. Default: always retry. */
  retryCheck?: (err: unknown) => boolean;
  /** Called after each failed attempt (useful for logging). */
  onAttempt?: (err: unknown, attempt: number) => void;
}

export const DEFAULT_RETRY_OPTIONS: WithRetriesOptions = {
  maxAttempts: 3,
  delayOpts: DEFAULT_DELAY_OPTIONS
};
export async function withRetries<T>(
  attemptsOpts: WithRetriesOptions,
  fn: () => Promise<T>
): Promise<T> {
  const attempts = attemptsOpts.maxAttempts;
  const retryCheck = attemptsOpts.retryCheck ?? (() => true);
  const notify =
    attemptsOpts.onAttempt ??
    (() => {
      /* noop */
    });

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      notify?.(err, i + 1);
      if (!retryCheck(err)) throw err;
      if (i < attempts - 1) {
        const wait = backoffDelay(i, attemptsOpts.delayOpts);
        await new Promise<void>((res) => setTimeout(res, wait));
      }
    }
  }
  throw lastErr;
}
