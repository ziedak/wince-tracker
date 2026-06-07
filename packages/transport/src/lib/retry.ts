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

export async function withRetries<T>(
  fn: () => Promise<T>,
  attempts = 3,
  onAttempt?: (err: any, attempt: number) => void,
  delayOpts?: Parameters<typeof backoffDelay>[1],
): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      onAttempt?.(err, i + 1);
      if (i < attempts - 1) {
        const wait = backoffDelay(i, delayOpts);
        await new Promise((res) => setTimeout(res, wait));
      }
    }
  }
  throw lastErr;
}
