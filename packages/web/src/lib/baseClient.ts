import { Transport } from '@wince/transport';
import type { DropReason } from '@wince/transport';
import { createDedupe } from './clientDedupe';
import { getOrCreateWindowId } from './_windowId';
import { consent as globalConsent, ConsentManager, type ConsentProvider } from '@wince/consent';
import type { PersonProps } from '@wince/core';

export interface BaseClientConfig {
  consent?: ConsentProvider | null;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  onEventDropped?: (reason: DropReason, event?: Partial<Record<string, unknown>>) => void;
  enrichmentReady?: boolean;
}

export abstract class BaseClient {
  protected _transport!: Transport;
  protected readonly _consent: ConsentProvider | null;
  protected readonly _windowId: string;
  protected readonly _onEventDropped?: (reason: DropReason, event?: Partial<Record<string, unknown>>) => void;
  protected readonly _diag = { sent: 0, droppedByReason: {} as Partial<Record<DropReason, number>> };
  protected readonly _fetch?: (url: string, init: RequestInit) => Promise<Response>;
  protected _enrichmentReady: boolean;
  protected _enrichmentProps?: Record<string, unknown>;
  protected _enrichmentPersonProps?: PersonProps;
  protected _pageviewId?: string;
  protected _prevPageviewId?: string;
  protected _unsubConsent?: () => void;
  protected _removeListeners?: () => void;
  protected readonly _recentEvents = createDedupe();

  constructor(config: BaseClientConfig) {
    this._consent = config.consent === undefined ? globalConsent : config.consent;
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

  optIn(): void {
    if (this._consent instanceof ConsentManager) {
      this._consent.optIn();
    } else {
      this._maybeStart();
    }
  }

  optOut(): void {
    if (this._consent instanceof ConsentManager) {
      this._consent.optOut();
    } else {
      this._transport.pause();
    }
  }

  // Subclasses provide a diagnostics snapshot with the concrete shape.
  abstract diagnostics(): unknown;
}
