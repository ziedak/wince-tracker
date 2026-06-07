export function backoffDelay(
  attempt: number,
  opts?: {
    baseDelayMs?: number;
    maxDelayMs?: number;
    factor?: number;
    jitter?: boolean;
  },
): number {
  const base = opts?.baseDelayMs ?? 100;
  const factor = opts?.factor ?? 2;
  const max = opts?.maxDelayMs ?? 10000;
  const jitter = opts?.jitter ?? true;
  const delay = Math.min(max, Math.round(base * Math.pow(factor, attempt)));
  if (!jitter) return delay;
  const rand = Math.random();
  return Math.round(delay * (0.5 + rand / 2));
}

export interface WithRetriesOptions {
  /** Number of total attempts (including the first). Default: 3 */
  attempts?: number;
  /** Return false to stop retrying immediately and rethrow. Default: always retry. */
  retryCheck?: (err: unknown) => boolean;
  /** Called after each failed attempt (useful for logging). */
  onAttempt?: (err: unknown, attempt: number) => void;
  baseDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: boolean;
}

export async function withRetries<T>(
  fn: () => Promise<T>,
  attemptsOrOpts: number | WithRetriesOptions = 3,
  onAttempt?: (err: unknown, attempt: number) => void,
  delayOpts?: Parameters<typeof backoffDelay>[1],
): Promise<T> {
  // Accept both the legacy positional signature and the new options object.
  const opts: WithRetriesOptions =
    typeof attemptsOrOpts === 'number'
      ? { attempts: attemptsOrOpts, onAttempt, ...delayOpts }
      : attemptsOrOpts;

  const attempts   = opts.attempts   ?? 3;
  const retryCheck = opts.retryCheck ?? (() => true);
  const notify     = opts.onAttempt  ?? onAttempt;

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      notify?.(err, i + 1);
      if (!retryCheck(err)) throw err;
      if (i < attempts - 1) {
        const wait = backoffDelay(i, opts);
        await new Promise<void>((res) => setTimeout(res, wait));
      }
    }
  }
  throw lastErr;
}
