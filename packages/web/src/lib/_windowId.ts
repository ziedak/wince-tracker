import { uuidv4 } from '@wince/utils';
import { SessionStore } from '@wince/storage';

/**
 * Tab-scoped window identifier.
 *
 * Stored in `sessionStorage` (lost on tab close, NOT shared across tabs).
 * Falls back to an in-memory UUID when `sessionStorage` is unavailable
 * (SSR, strict cookie settings, Worker context).
 *
 * Both `WinceClient` and `WorkerClient` call this on construction so that
 * any two instances created in the same tab share the same `window_id`.
 */
export const WINDOW_ID_KEY = 'wince_wid';

export function getOrCreateWindowId(): string {
  try {
    const sessionStorage = SessionStore;
    const stored = sessionStorage.get<string>(WINDOW_ID_KEY);
    if (stored) return stored;
    const id = uuidv4();
    sessionStorage.set(WINDOW_ID_KEY, id);
    return id;
  } catch {
    // sessionStorage blocked (ITP, private browsing, SSR) — in-memory fallback.
    return uuidv4();
  }
}
