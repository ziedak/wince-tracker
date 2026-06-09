import type { Transport } from '@wince/transport';
import type { DropReason } from '@wince/transport';

export function buildBaseDiagnostics(
  diag: { sent: number; droppedByReason: Partial<Record<DropReason, number>> },
  transport: Transport,
  idbQueueSize: Promise<number>,
) {
  const dropped = Object.values(diag.droppedByReason).reduce((a, b) => a + (b ?? 0), 0);
  return {
    eventsQueued: transport.queueSize,
    eventsSent: diag.sent,
    eventsDropped: dropped,
    droppedByReason: { ...diag.droppedByReason },
    circuitOpen: transport.circuitOpen,
    idbQueueSize,
  };
}
