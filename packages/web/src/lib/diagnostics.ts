import type { ITransport } from '@wince/transport';
import { DropReason } from '@wince/types';

export function buildBaseDiagnostics(
  diag: { sent: number; droppedByReason: Partial<Record<DropReason, number>> },
  transport: ITransport,
  idbQueueSize: Promise<number>
) {
  const dropped = Object.values(diag.droppedByReason).reduce((a, b) => a + (b ?? 0), 0);
  return {
    eventsQueued: transport.queueSize,
    eventsSent: diag.sent,
    eventsDropped: dropped,
    droppedByReason: { ...diag.droppedByReason },
    circuitOpen: transport.circuitOpen,
    idbQueueSize
  };
}
