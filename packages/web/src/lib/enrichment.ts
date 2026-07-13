export interface EnrichmentResult {
  uid?: string;
  props?: Record<string, unknown>;
  personProps?: {
    $set?: Record<string, unknown>;
    $set_once?: Record<string, unknown>;
  };
}

/**
 * Best-effort enrichment fetch (fire-and-forget).
 *
 * Fires a GET to the enrichment endpoint with anon + session IDs.
 * The transport does NOT wait for this to complete — events are sent
 * immediately with anonymous identity, and the enrichment result
 * (if it arrives) is applied to the events buffered before resolution.
 *
 * For real-time identification after init, use the WebSocket-based
 * `@wince/messaging` path which can push `identify` commands at any time.
 */
export async function fetchEnrichment(
  url: string,
  getAnon: () => string | undefined,
  getSession: () => string | undefined,
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>,
  timeoutMs = 1_500,
): Promise<EnrichmentResult | undefined> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const fetchUrl = new URL(
      url,
      typeof location !== 'undefined' ? location.href : undefined,
    );
    fetchUrl.searchParams.set('anon', getAnon() ?? '');
    fetchUrl.searchParams.set('session', getSession() ?? '');

    const fn = fetchFn ?? fetch;
    const resp = await fn(fetchUrl.toString(), {
      signal: controller.signal,
      method: 'GET',
    });
    clearTimeout(timer);

    if (!resp.ok) return undefined;
    const raw: unknown = await resp.json();
    if (!raw || typeof raw !== 'object') return undefined;

    const data = raw as Record<string, unknown>;
    const $set =
      data.$set instanceof Object && !Array.isArray(data.$set)
        ? (data.$set as Record<string, unknown>)
        : undefined;
    const $set_once =
      data.$set_once instanceof Object && !Array.isArray(data.$set_once)
        ? (data.$set_once as Record<string, unknown>)
        : undefined;
    const uid = typeof data.uid === 'string' ? data.uid : undefined;

    const { uid: _u, $set: _s, $set_once: _so, ...rest } = data;
    const props = Object.keys(rest).length > 0 ? rest : undefined;

    return {
      uid,
      props,
      personProps: $set || $set_once ? { $set, $set_once } : undefined,
    };
  } catch {
    return undefined;
  }
}