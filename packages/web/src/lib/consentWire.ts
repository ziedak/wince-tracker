import { ConsentStatus } from '@wince/consent';
import type { IConsent } from '@wince/consent';

export type ConsentWireHandlers = {
  onGrant?: () => void;
  onRevoke?: () => void;
  onMigrate?: () => void;
};

/**
 * Wire a ConsentProvider to simple callbacks. Returns an unsubscribe function
 * or `undefined` when `consent` is `null`.
 */
export function wireConsent(
  consent: IConsent,
  cookieless: 'off' | 'on_reject' | 'always' | undefined,
  handlers: ConsentWireHandlers
): (() => void) | undefined {
  if (consent === null) return undefined;

  const unsub = consent.onChange((status) => {
    if (status === ConsentStatus.GRANTED) {
      if (cookieless === 'on_reject') handlers.onMigrate?.();
      handlers.onGrant?.();
    } else {
      handlers.onRevoke?.();
    }
  });

  return unsub;
}
