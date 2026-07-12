import { createClientTransport, ITransport, TransportOptions } from '@wince/transport';
import { createDedupe } from './clientDedupe';
import { getOrCreateWindowId } from './_windowId';
import type { PersonProps } from '@wince/core';
import { DropReason,  TrackEventPayload } from '@wince/types';
import { Consent, ConsentOptions, IConsent } from '@wince/consent';
import { CookieStore } from '@wince/storage';
export interface BaseClientConfig {
  transportOptions: TransportOptions<TrackEventPayload>;
  consentOptions: ConsentOptions;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  onEventDropped?: (reason: DropReason, event?: Partial<TrackEventPayload>) => void;
  enrichmentReady?: boolean;
}

export abstract class BaseClient {
  protected readonly _windowId: string;
  protected readonly _onEventDropped?: (
    reason: DropReason,
    event?: Partial<TrackEventPayload>
  ) => void;
  protected readonly _diag = {
    sent: 0,
    droppedByReason: {} as Partial<Record<DropReason, number>>
  };
  protected readonly _fetch?: (url: string, init: RequestInit) => Promise<Response>;
  protected _enrichmentReady: boolean;
  protected _enrichmentProps?: Record<string, unknown>;
  protected _enrichmentPersonProps?: PersonProps;
  protected _pageviewId?: string;
  protected _prevPageviewId?: string;
  protected _unsubConsent?: () => void;
  protected _removeListeners?: () => void;
  protected readonly _recentEvents = createDedupe();
  protected _transport: ITransport;
  protected readonly _consent: IConsent;
  constructor(config: BaseClientConfig, _consent?: IConsent) {
    const transportOpts: TransportOptions<TrackEventPayload> = config.transportOptions;
    transportOpts.onBatchDelivered = this.onBatchDelivered.bind(this);
    transportOpts.onDropped = this.onDropped.bind(this);
    this._transport = createClientTransport(transportOpts);

    this._consent =
      _consent ??
      new Consent(
        config.consentOptions,
        CookieStore({
          crossSubdomain: true,
          secure: typeof location !== 'undefined' && location.protocol === 'https:',
          sameSite: 'Lax',
          maxAgeDays: 365
        })
      );
    this._onEventDropped = config.onEventDropped;
    this._fetch = config.fetch;
    this._enrichmentReady = config.enrichmentReady ?? true;

    this._windowId = getOrCreateWindowId();
  }

  protected _drop(reason: DropReason): void {
    this._diag.droppedByReason[reason] = (this._diag.droppedByReason[reason] ?? 0) + 1;
    this._onEventDropped?.(reason);
  }

  protected _maybeStart(): void {
    if (!this._enrichmentReady) return;
    if (this._consent !== null && !this._consent.isGranted()) return;
    this._transport.start();
  }
  onDropped(reason: DropReason, item?: Partial<TrackEventPayload>) {
    this._diag.droppedByReason[reason] = (this._diag.droppedByReason[reason] ?? 0) + 1;
    this._onEventDropped?.(reason, item);
  }
  onBatchDelivered(eids: string[]) {
    this._diag.sent += eids.length;
  }
  optIn(): void {
    if (this._consent) {
      this._consent.optIn();
    } else {
      this._maybeStart();
    }
  }

  optOut(): void {
    if (this._consent) {
      this._consent.optOut();
    } else {
      this._transport.pause();
    }
  }

  // Subclasses provide a diagnostics snapshot with the concrete shape.
  abstract diagnostics(): unknown;
}
