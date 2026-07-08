import { type TrackEventPayload } from '@wince/types';
export function applyEnrichmentOnceToEvents(
  events: TrackEventPayload[],
  enrichmentProps?: Record<string, unknown>,
  enrichmentPersonProps?: {
    $set?: Record<string, unknown>;
    $set_once?: Record<string, unknown>;
  },
): { events: TrackEventPayload[]; applied: boolean } {
  const out: TrackEventPayload[] = [];
  let applied = false;
  for (const ev of events) {
    if (
      !applied &&
      ev.n !== '$identify' &&
      (enrichmentProps || enrichmentPersonProps)
    ) {
      const newEv = {
        ...ev,
        props: enrichmentProps
          ? {
              ...(enrichmentProps as Record<string, unknown>),
              ...(ev.props ?? {}),
            }
          : ev.props,
        $set: enrichmentPersonProps
          ? { ...(enrichmentPersonProps.$set ?? {}), ...(ev.$set ?? {}) }
          : ev.$set,
        $set_once: enrichmentPersonProps
          ? {
              ...(enrichmentPersonProps.$set_once ?? {}),
              ...(ev.$set_once ?? {}),
            }
          : ev.$set_once,
      };
      out.push(newEv);
      applied = true;
    } else {
      out.push(ev);
    }
  }
  return { events: out, applied };
}
