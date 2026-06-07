/**
 * Typed result of a single HTTP send attempt.
 * All HTTP status classification is centralised here — callers switch on `kind`,
 * never on raw status codes.
 *
 *  ok         → batch accepted; advance buffer, linearly recover batchSize
 *  retry      → transient failure (network error, 429, 5xx); keep records, backoff
 *  too-large  → 413; halve batchSize and retry the same records
 *  fatal      → non-retryable client error (400, 401, 403, 422…); drop batch
 */
export type SendOutcome =
  | { kind: 'ok' }
  | { kind: 'retry';     retryAfterMs?: number }
  | { kind: 'too-large'                        }
  | { kind: 'fatal';     status: number        };

/** Classify an HTTP status code into a SendOutcome kind (without retryAfterMs). */
export function classifyStatus(status: number): SendOutcome {
  if (status >= 200 && status < 300) return { kind: 'ok' };
  if (status === 413)                 return { kind: 'too-large' };
  if (status === 429)                 return { kind: 'retry' };
  if (status >= 500)                  return { kind: 'retry' };
  // 4xx that are not 413/429 are non-retryable client errors
  return { kind: 'fatal', status };
}
