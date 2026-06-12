/// <reference lib="dom" />
/// <reference types="vite/client" />

import './app.element.css';
import { ConsentManager, ConsentStatus } from '@wince/consent';
import {
  init,
  mountCart,
  mountClick,
  mountCopyPaste,
  mountDeadClick,
  mountErrorCapture,
  mountExitIntent,
  mountFormAbandon,
  mountFormInteraction,
  mountPageView,
  mountRageClick,
} from '@wince/web';

type LogLevel = 'info' | 'event' | 'state' | 'error';

type LogEntry = {
  level: LogLevel;
  label: string;
  detail?: string;
};

type InterceptEntry = {
  stage: string;
  event: string;
  detail?: string;
};

type TransportBatchEntry = {
  sentAt?: number;
  eventCount: number;
  eventNames: string[];
  detail: string;
};

type DiagnosticsEntry = {
  eventsQueued: number;
  eventsSent: number;
  eventsDropped: number;
  circuitOpen: boolean;
  sessionId: string;
  windowId: string;
  anonId: string;
  idbQueueSize: number | null;
  droppedByReason: string;
  dntActive: boolean;
};

type QueueEntry = {
  name: string;
  ts: number;
  props: string;
  status: 'queued' | 'flushed';
};

function pretty(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return character;
    }
  });
}

function describeInterceptSource(source: unknown): string {
  return typeof source === 'string' && source.length > 0 ? source : 'unknown';
}

async function readBodyText(body: RequestInit['body']): Promise<string> {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Blob) return body.text();
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    );
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return JSON.stringify(Array.from(body.entries()));
  }
  return String(body);
}

function parseTransportBatch(
  raw: string,
): { sentAt?: number; eventNames: string[] } | null {
  try {
    const parsed = JSON.parse(raw) as {
      sent_at?: number;
      events?: Array<{ t?: string }>;
    };
    const events = Array.isArray(parsed.events) ? parsed.events : [];
    return {
      sentAt: parsed.sent_at,
      eventNames: events.map((event) => event.t ?? 'unknown'),
    };
  } catch {
    return null;
  }
}

function formatDiagnosticsCount(value: number | null | undefined): string {
  return value == null ? '—' : String(value);
}

function formatOptional(value: string | undefined): string {
  return value && value.length > 0 ? value : '—';
}

function readCartContext(root: ParentNode): Record<string, unknown> {
  const form = root.querySelector('[data-role="cart-context"]');
  if (!(form instanceof HTMLFormElement)) {
    return {
      product_id: 'SKU-RECOVERY-01',
      variant_id: 'variant-default',
      currency: 'USD',
      price: 49.99,
      quantity: 1,
      cart_id: 'CART-PLAYGROUND-01',
    };
  }

  const data = new FormData(form);
  const productId = String(data.get('product_id') ?? 'SKU-RECOVERY-01');
  const variantId = String(data.get('variant_id') ?? 'variant-default');
  const currency = String(data.get('currency') ?? 'USD').toUpperCase();
  const price = Number(data.get('price') ?? 49.99);
  const quantity = Number(data.get('quantity') ?? 1);
  const cartId = String(data.get('cart_id') ?? 'CART-PLAYGROUND-01');

  return {
    product_id: productId,
    variant_id: variantId,
    currency,
    price: Number.isFinite(price) ? price : 49.99,
    quantity: Number.isFinite(quantity) ? quantity : 1,
    cart_id: cartId,
  };
}

export class AppElement extends HTMLElement {
  public static observedAttributes = [];

  // ignoreDnt:true — lets the playground opt-in even if the browser reports DNT=1.
  // Without this, DNT silently forces DENIED and the cookie value is ignored.
  private readonly _consent = new ConsentManager({ ignoreDnt: true });
  private readonly _cleanup: Array<() => void> = [];
  private readonly _runtimeEntries: LogEntry[] = [];
  private readonly _interceptEntries: InterceptEntry[] = [];
  private readonly _transportEntries: TransportBatchEntry[] = [];
  private readonly _queueEntries: QueueEntry[] = [];
  private readonly _client = init({
    endpoint: '/__wince__/collect',
    consent: this._consent,
    compress: false,
    fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
      const rawBody = await readBodyText(init?.body);
      const batch = parseTransportBatch(rawBody);
      this._recordTransport(batch, rawBody);
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
    onEventDropped: (reason, event) => {
      this._record('error', `dropped:${reason}`, pretty(event ?? {}));
      this.scheduleDiagnosticsRefresh();
    },
    beforeTrack: (event) => {
      this._recordIntercept(
        describeInterceptSource(event.props?.$plugin_source),
        event.t,
        pretty(event.props ?? {}),
      );
      this._record('event', event.t, pretty(event.props ?? {}));
      this._addQueueEntry(event.t, event.props ?? {});
      this.scheduleDiagnosticsRefresh();
      return event;
    },
  });

  connectedCallback() {
    this.bindControls();
    this.mountNativeSurface();
    this.mountTracker();
    this.refreshConsentState();
    this.renderFeeds();
    this.scheduleDiagnosticsRefresh();
    this._record('info', 'ready', 'Tracker harness initialized');
  }

  disconnectedCallback() {
    for (const cleanup of this._cleanup.splice(0)) cleanup();
  }

  private bindControls() {
    const trackPageView = this.querySelector('[data-role="track-page-view"]');
    const trackCustom = this.querySelector('[data-role="track-custom"]');
    const raiseError = this.querySelector('[data-role="raise-error"]');
    const optIn = this.querySelector('[data-role="opt-in"]');
    const optOut = this.querySelector('[data-role="opt-out"]');
    const clearForm = this.querySelector('[data-role="clear-form"]');
    const form = this.querySelector('#lead-form');

    const addListener = (
      target: Element | null,
      event: string,
      handler: () => void,
    ) => {
      if (!target) return;
      target.addEventListener(event, handler);
      this._cleanup.push(() => target.removeEventListener(event, handler));
    };

    addListener(trackPageView, 'click', () => {
      this._client.page({
        surface: 'playground',
        section: 'manual',
        $plugin_source: 'playground.manual',
      });
      this._record('state', 'page_view', 'Explicit page view emitted');
    });

    addListener(trackCustom, 'click', () => {
      this._client.track('$custom_probe', {
        source: 'playground',
        step: 'manual',
        $plugin_source: 'playground.manual',
      });
      this._record('state', 'custom', 'Custom event emitted');
    });

    addListener(raiseError, 'click', () => {
      try {
        throw new Error('Playground synthetic error');
      } catch (error) {
        this._client.track('$error', {
          type: 'manual_probe',
          message:
            error instanceof Error
              ? error.message
              : 'Playground synthetic error',
          stack: error instanceof Error ? error.stack : undefined,
          $plugin_source: 'playground.manual',
        });
        this._record(
          'error',
          'synthetic error',
          'Tracked synthetic error event',
        );
      }
    });

    addListener(optIn, 'click', () => {
      this._consent.optIn();
      this.refreshConsentState();
      this._record('state', 'consent', 'Opted in');
      this.scheduleDiagnosticsRefresh();
    });

    addListener(optOut, 'click', () => {
      this._consent.optOut();
      this.refreshConsentState();
      this._record('state', 'consent', 'Opted out');
      this.scheduleDiagnosticsRefresh();
    });

    addListener(clearForm, 'click', () => {
      (form as HTMLFormElement | null)?.reset();
      this._record('state', 'form', 'Form reset');
    });

    if (form instanceof HTMLFormElement) {
      const onSubmit = (event: Event) => {
        event.preventDefault();
        const data = new FormData(form);
        this._client.track('$form_submit', {
          form_id: form.id,
          fields: Object.fromEntries(data.entries()),
          $plugin_source: 'playground.manual',
        });
        this._record('state', 'form submit', 'Form submitted');
      };
      form.addEventListener('submit', onSubmit);
      this._cleanup.push(() => form.removeEventListener('submit', onSubmit));
    }

    this.querySelectorAll('[data-action]').forEach((button) => {
      const handler = () => {
        const action = button.getAttribute('data-action');
        if (!action) return;
        const cartContext = readCartContext(this);
        const cartAction =
          action === 'add'
            ? 'add'
            : action === 'remove'
              ? 'remove'
              : action === 'checkout-start'
                ? 'checkout_start'
                : 'checkout_complete';
        document.dispatchEvent(
          new CustomEvent('wince:cart', {
            detail: {
              action: cartAction,
              ...cartContext,
              price:
                action === 'remove' ? 0 : Number(cartContext.price ?? 49.99),
            },
          }),
        );
        this._record('state', action, JSON.stringify(cartContext, null, 2));
      };
      button.addEventListener('click', handler);
      this._cleanup.push(() => button.removeEventListener('click', handler));
    });
  }

  private mountNativeSurface() {
    const trackedTypes = [
      'focusin',
      'focusout',
      'input',
      'change',
      'keydown',
      'keyup',
      'pointerdown',
      'pointerup',
      'submit',
      'scroll',
    ] as const;

    const handler = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || !this.contains(target)) return;

      const parts: string[] = [];
      parts.push(target.tagName.toLowerCase());

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        const field = target.name || target.id || target.type || 'field';
        parts.push(field);
        if (target instanceof HTMLInputElement && target.type === 'checkbox') {
          parts.push(target.checked ? 'checked' : 'unchecked');
        } else if (
          'value' in target &&
          typeof target.value === 'string' &&
          target.value.length > 0
        ) {
          parts.push(target.value.slice(0, 48));
        }
      } else if (target instanceof HTMLButtonElement && target.textContent) {
        parts.push(target.textContent.trim().slice(0, 32));
      }

      if (event instanceof KeyboardEvent) {
        parts.push(`key=${event.key}`);
      }
      if (event instanceof PointerEvent) {
        parts.push(`button=${event.button}`);
      }

      this._record('event', `native:${event.type}`, parts.join(' · '));
    };

    for (const type of trackedTypes) {
      document.addEventListener(type, handler, true);
      this._cleanup.push(() =>
        document.removeEventListener(type, handler, true),
      );
    }
  }

  private mountTracker() {
    const cleanupFns = [
      mountPageView(this._client, {
        trackScrollDepth: true,
        trackVisibility: true,
        trackTimeOnPage: true,
      }),
      mountCart(this._client),
      mountClick(this._client),
      mountCopyPaste(this._client),
      mountDeadClick(this._client),
      mountErrorCapture(this._client),
      mountExitIntent(this._client),
      mountFormAbandon(this._client),
      mountFormInteraction(this._client),
      mountRageClick(this._client),
    ];

    for (const cleanup of cleanupFns) this._cleanup.push(cleanup);
  }

  private refreshConsentState() {
    const consentState = this.querySelector('[data-role="consent-state"]');
    if (!consentState) return;
    const status = this._consent.getStatus();
    consentState.textContent =
      status === ConsentStatus.GRANTED
        ? 'Granted'
        : status === ConsentStatus.DENIED
          ? 'Denied'
          : 'Pending';
  }

  private scheduleDiagnosticsRefresh() {
    void this.refreshDiagnostics();
  }

  private async refreshDiagnostics() {
    const diagnostics = this._client.diagnostics();
    const idbQueueSize = await Promise.resolve(diagnostics.idbQueueSize).catch(
      () => 0,
    );
    const snapshot: DiagnosticsEntry = {
      eventsQueued: diagnostics.eventsQueued,
      eventsSent: diagnostics.eventsSent,
      eventsDropped: diagnostics.eventsDropped,
      circuitOpen: diagnostics.circuitOpen,
      sessionId: formatOptional(diagnostics.sessionId),
      windowId: diagnostics.windowId,
      anonId: formatOptional(diagnostics.anonId),
      idbQueueSize,
      droppedByReason: JSON.stringify(diagnostics.droppedByReason, null, 2),
      dntActive: this._consent.isDntActive(),
    };

    const setText = (selector: string, value: string) => {
      const element = this.querySelector(selector);
      if (element) element.textContent = value;
    };

    setText(
      '[data-role="diag-events-queued"]',
      formatDiagnosticsCount(snapshot.eventsQueued),
    );
    setText(
      '[data-role="diag-events-sent"]',
      formatDiagnosticsCount(snapshot.eventsSent),
    );
    setText(
      '[data-role="diag-events-dropped"]',
      formatDiagnosticsCount(snapshot.eventsDropped),
    );
    setText(
      '[data-role="diag-circuit-open"]',
      snapshot.circuitOpen ? 'Open' : 'Closed',
    );
    setText('[data-role="diag-session-id"]', snapshot.sessionId);
    setText('[data-role="diag-window-id"]', snapshot.windowId);
    setText('[data-role="diag-anon-id"]', snapshot.anonId);
    setText(
      '[data-role="diag-idb-queue-size"]',
      formatDiagnosticsCount(snapshot.idbQueueSize),
    );
    setText(
      '[data-role="diag-dnt"]',
      snapshot.dntActive
        ? '⚠️ Active (consent overridden — ignoreDnt=true)'
        : 'Not set',
    );

    const dropped = this.querySelector('[data-role="diag-dropped-reasons"]');
    if (dropped) dropped.textContent = snapshot.droppedByReason;
  }

  private renderFeeds() {
    this.renderRuntimeFeed();
    this.renderInterceptFeed();
    this.renderTransportFeed();
    this.renderQueueFeed();
  }

  private renderRuntimeFeed() {
    const log = this.querySelector('[data-role="log"]');
    if (!log) return;
    log.innerHTML = this._runtimeEntries
      .map(
        (entry) => `
          <article class="feed-entry ${escapeHtml(entry.level)}">
            <span class="label">${escapeHtml(entry.label)}</span>
            <span class="detail">${escapeHtml(entry.detail ?? '')}</span>
          </article>
        `,
      )
      .join('');
  }

  private renderInterceptFeed() {
    const interceptLog = this.querySelector('[data-role="intercept-log"]');
    if (!interceptLog) return;
    interceptLog.innerHTML = this._interceptEntries
      .map(
        (entry) => `
          <article class="feed-entry intercepted">
            <div class="feed-meta">
              <span class="source">${escapeHtml(entry.stage)}</span>
              <span class="event">${escapeHtml(entry.event)}</span>
            </div>
            <pre class="detail">${escapeHtml(entry.detail ?? '')}</pre>
          </article>
        `,
      )
      .join('');
  }

  private renderTransportFeed() {
    const transportLog = this.querySelector('[data-role="transport-log"]');
    if (!transportLog) return;
    transportLog.innerHTML = this._transportEntries
      .map(
        (entry) => `
          <article class="feed-entry transport">
            <div class="feed-meta">
              <span class="source">transport batch</span>
              <span class="event">${entry.eventCount} event${entry.eventCount === 1 ? '' : 's'}</span>
            </div>
            <div class="transport-meta">
              <span>sent_at: ${escapeHtml(formatOptional(entry.sentAt ? new Date(entry.sentAt).toISOString() : undefined))}</span>
              <span>events: ${escapeHtml(entry.eventNames.join(', ') || 'none')}</span>
            </div>
            <pre class="detail">${escapeHtml(entry.detail)}</pre>
          </article>
        `,
      )
      .join('');
  }

  private _recordTransport(
    batch: { sentAt?: number; eventNames: string[] } | null,
    rawBody: string,
  ) {
    const entry: TransportBatchEntry = {
      sentAt: batch?.sentAt,
      eventCount: batch?.eventNames.length ?? 0,
      eventNames: batch?.eventNames ?? [],
      detail: rawBody,
    };
    this._transportEntries.unshift(entry);
    this._transportEntries.splice(10);
    // Mark the matching queued events as flushed
    const flushedNames = new Set(batch?.eventNames ?? []);
    let remaining = batch?.eventNames.length ?? 0;
    for (const q of this._queueEntries) {
      if (remaining <= 0) break;
      if (q.status === 'queued' && flushedNames.has(q.name)) {
        q.status = 'flushed';
        remaining--;
      }
    }
    this._record('state', 'transport', rawBody);
    this.renderTransportFeed();
    this.renderQueueFeed();
    this.scheduleDiagnosticsRefresh();
  }

  private _recordIntercept(source: string, event: string, detail?: string) {
    this._interceptEntries.unshift({ stage: source, event, detail });
    this._interceptEntries.splice(20);
    this.renderInterceptFeed();
  }

  private _addQueueEntry(name: string, props: Record<string, unknown>) {
    this._queueEntries.unshift({
      name,
      ts: Date.now(),
      props: pretty(props),
      status: 'queued',
    });
    this._queueEntries.splice(40);
    this.renderQueueFeed();
  }

  private renderQueueFeed() {
    const el = this.querySelector('[data-role="queue-log"]');
    if (!el) return;
    el.innerHTML = this._queueEntries
      .map(
        (entry) => `
          <article class="feed-entry queue-entry ${escapeHtml(entry.status)}">
            <div class="feed-meta">
              <span class="status-badge ${escapeHtml(entry.status)}">${entry.status === 'queued' ? '⏳ queued' : '✅ flushed'}</span>
              <span class="event">${escapeHtml(entry.name)}</span>
              <span class="ts">${new Date(entry.ts).toLocaleTimeString()}</span>
            </div>
            <pre class="detail">${escapeHtml(entry.props)}</pre>
          </article>
        `,
      )
      .join('');
  }

  private _record(level: LogLevel, label: string, detail?: string) {
    this._runtimeEntries.unshift({ level, label, detail });
    this._runtimeEntries.splice(20);
    this.renderRuntimeFeed();
  }
}

customElements.define('wince-root', AppElement);
