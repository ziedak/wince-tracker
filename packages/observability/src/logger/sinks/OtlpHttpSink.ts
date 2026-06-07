import type { ILogSink, LogAttributeValue, LogRecord, Resource } from '../logger.type';

// ============================================================================
// OTLP wire types — internal to this file, never exported
// ============================================================================

interface OtlpAnyValue {
  stringValue?: string;
  intValue?: number;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values: OtlpAnyValue[] };
}
interface OtlpKV { key: string; value: OtlpAnyValue; }

interface OtlpWireRecord {
  timeUnixNano: string;
  observedTimeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes: OtlpKV[];
  traceId?: string;
  spanId?: string;
}

interface OtlpPayload {
  resourceLogs: Array<{
    resource: { attributes: OtlpKV[] };
    scopeLogs: Array<{
      scope: { name: string; version?: string };
      logRecords: OtlpWireRecord[];
    }>;
  }>;
}

// ============================================================================
// Encoding helpers
// ============================================================================

function toOtlpValue(v: LogAttributeValue): OtlpAnyValue {
  // null/undefined have no native OTLP type; encode as a string so the value
  // isn't silently lost (important when they appear inside array elements).
  if (v === null || v === undefined) return { stringValue: String(v) };
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number') {
    // Non-finite values (NaN, +/-Infinity) have no JSON/proto3 representation;
    // encode as string to preserve the human-readable signal.
    if (!Number.isFinite(v)) return { stringValue: String(v) };
    if (Number.isInteger(v)) return { intValue: v };
    return { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) {
    return { arrayValue: { values: (v as LogAttributeValue[]).map(toOtlpValue) } };
  }
  try { return { stringValue: JSON.stringify(v) }; } catch { return { stringValue: String(v) }; }
}

function toKVList(attrs: Record<string, LogAttributeValue>): OtlpKV[] {
  return Object.entries(attrs)
    .filter(([, v]) => v != null)
    .map(([k, v]) => ({ key: k, value: toOtlpValue(v!) }));
}

function encodeRecord(rec: LogRecord): OtlpWireRecord {
  const attrs = toKVList(rec.fields as Record<string, LogAttributeValue>);

  if (rec.error) {
    attrs.push({ key: 'error.type',    value: { stringValue: rec.error.name } });
    attrs.push({ key: 'error.message', value: { stringValue: rec.error.message } });
    if (rec.error.stack) {
      attrs.push({ key: 'error.stack', value: { stringValue: rec.error.stack } });
    }
  }

  const wire: OtlpWireRecord = {
    timeUnixNano:         rec.timestampNano,
    observedTimeUnixNano: rec.timestampNano,
    severityNumber:       rec.severityNumber,
    severityText:         rec.severityText,
    body:                 { stringValue: rec.message },
    attributes:           attrs,
  };

  if (rec.traceId) wire.traceId = rec.traceId;
  if (rec.spanId)  wire.spanId  = rec.spanId;

  return wire;
}

function buildResourceAttrs(resource: Resource): OtlpKV[] {
  const attrs: Record<string, LogAttributeValue> = {};
  // Copy unknown extra keys first, then override with well-known OTLP keys
  for (const [k, v] of Object.entries(resource)) {
    if (k !== 'serviceName' && k !== 'serviceVersion' && k !== 'environment' && v != null) {
      attrs[k] = v;
    }
  }
  if (resource.serviceName)    attrs['service.name']           = resource.serviceName;
  if (resource.serviceVersion) attrs['service.version']        = resource.serviceVersion;
  if (resource.environment)    attrs['deployment.environment'] = resource.environment;
  return toKVList(attrs);
}

function buildPayload(
  records: OtlpWireRecord[],
  resource: Resource,
  scopeName: string,
  scopeVersion?: string,
): OtlpPayload {
  return {
    resourceLogs: [{
      resource: { attributes: buildResourceAttrs(resource) },
      scopeLogs: [{
        scope: { name: scopeName, ...(scopeVersion ? { version: scopeVersion } : {}) },
        logRecords: records,
      }],
    }],
  };
}

// ============================================================================
// Sink
// ============================================================================

export interface OtlpHttpSinkOptions {
  /** OTLP/HTTP logs endpoint */
  endpoint: string;
  /** Extra HTTP headers (e.g. auth token) */
  headers?: Record<string, string>;
  /** Instrumentation scope name (SDK/library identifier). Default: 'wince' */
  scopeName?: string;
  /** Instrumentation scope version */
  scopeVersion?: string;
  /** Max records per POST. Halves on 413; recovers linearly on success. Default: 100 */
  maxBatchSize?: number;
  /** Periodic flush interval (ms). Default: 3000 */
  flushIntervalMs?: number;
  /** Max records held in memory before oldest is dropped. Default: 500 */
  maxBufferSize?: number;
  /**
   * Optional rate cap — applied AFTER global + per-sink beforeSend,
   * so filtered-out records never consume the budget.
   */
  rateLimit?: { maxPerInterval: number; windowMs: number };
  /** Injectable fetch for testing */
  fetch?: (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;
}

type FetchFn = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

export class OtlpHttpSink implements ILogSink {
  private readonly _endpoint: string;
  private readonly _headers: Record<string, string>;
  private readonly _scopeName: string;
  private readonly _scopeVersion?: string;
  private readonly _maxBufferSize: number;
  private readonly _flushIntervalMs: number;
  private readonly _rateLimit?: { maxPerInterval: number; windowMs: number };
  private readonly _fetchFn: FetchFn;
  private readonly _configuredMaxBatch: number;

  private _buffer: LogRecord[] = [];
  private _flushTimer?: ReturnType<typeof setTimeout>;
  private _flushPromise: Promise<void> | null = null;
  private _maxBatchSize: number;

  // Tumbling-window rate cap state
  private _rateWindowStart = 0;
  private _rateCount = 0;
  private _rateDropWarned = false;

  constructor(opts: OtlpHttpSinkOptions) {
    this._endpoint          = opts.endpoint;
    this._headers           = { 'Content-Type': 'application/json', ...opts.headers };
    this._scopeName         = opts.scopeName    ?? 'wince';
    this._scopeVersion      = opts.scopeVersion;
    this._maxBufferSize     = opts.maxBufferSize     ?? 500;
    this._flushIntervalMs   = opts.flushIntervalMs   ?? 3000;
    this._rateLimit         = opts.rateLimit;
    this._fetchFn           = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this._configuredMaxBatch = opts.maxBatchSize ?? 100;
    this._maxBatchSize       = this._configuredMaxBatch;
  }

  write(record: LogRecord): void {
    // Rate cap runs here — AFTER global + per-sink beforeSend,
    // so filtered-out records never consume the budget.
    if (!this._checkRate()) return;

    if (this._buffer.length >= this._maxBufferSize) {
      this._buffer.shift(); // drop oldest when buffer is full
    }
    this._buffer.push(record);

    if (this._buffer.length >= this._maxBatchSize) {
      this._flushInBackground();
    } else {
      this._armTimer();
    }
  }

  private _checkRate(): boolean {
    if (!this._rateLimit) return true;
    const { maxPerInterval, windowMs } = this._rateLimit;
    const now = Date.now();
    const elapsed = now - this._rateWindowStart;
    // Reset on window expiry OR on clock going backward (NTP correction safety)
    if (elapsed >= windowMs || elapsed < 0) {
      this._rateWindowStart = now;
      this._rateCount = 0;
      this._rateDropWarned = false;
    }
    if (this._rateCount >= maxPerInterval) {
      if (!this._rateDropWarned) {
        console.warn(`[OtlpHttpSink] rate cap: >${maxPerInterval} records/${windowMs}ms`);
        this._rateDropWarned = true;
      }
      return false;
    }
    this._rateCount++;
    return true;
  }

  private _armTimer(): void {
    if (this._flushTimer !== undefined) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = undefined;
      this._flushInBackground();
    }, this._flushIntervalMs);
  }

  private _clearTimer(): void {
    if (this._flushTimer !== undefined) {
      clearTimeout(this._flushTimer);
      this._flushTimer = undefined;
    }
  }

  private _flushInBackground(): void {
    void this.flush().catch((err) => {
      console.error('[OtlpHttpSink] flush error', err);
    });
  }

  /** Flush the buffer. Concurrent calls are serialised — no double-send. */
  async flush(): Promise<void> {
    if (this._flushPromise) return this._flushPromise;
    this._flushPromise = this._flushInner().finally(() => { this._flushPromise = null; });
    return this._flushPromise;
  }

  private async _flushInner(): Promise<void> {
    this._clearTimer();
    while (this._buffer.length > 0) {
      const batchSize = Math.min(this._buffer.length, this._maxBatchSize);
      const batch = this._buffer.slice(0, batchSize);
      const resource = batch[0]?.resource ?? {};
      const payload = buildPayload(
        batch.map(encodeRecord),
        resource,
        this._scopeName,
        this._scopeVersion,
      );

      const status = await this._post(payload);

      if (status === 413 && batchSize > 1) {
        // Adaptive backoff: halve the cap and retry the same head-of-queue records
        this._maxBatchSize = Math.max(1, Math.floor(batchSize / 2));
        continue;
      }

      if (status === -1) {
        // Network error — keep records in buffer for the next flush cycle
        throw new Error('[OtlpHttpSink] network error — will retry on next flush');
      }

      if (status === 413) {
        // Single record is over the server limit — drop to avoid infinite loop
        console.warn('[OtlpHttpSink] dropping oversized single record (413 with batchSize=1)');
      }

      // Advance buffer (covers: ok, 4xx/5xx non-retryable, single-record 413)
      this._buffer = this._buffer.slice(batchSize);

      // Linear recovery: each successful send pushes the cap back up by 1
      if (status !== 413 && this._maxBatchSize < this._configuredMaxBatch) {
        this._maxBatchSize = Math.min(this._configuredMaxBatch, this._maxBatchSize + 1);
      }
    }
  }

  private async _post(payload: OtlpPayload): Promise<number> {
    try {
      const resp = await this._fetchFn(this._endpoint, {
        method: 'POST',
        headers: this._headers,
        body: JSON.stringify(payload),
      });
      return resp.status;
    } catch {
      return -1; // network failure
    }
  }

  async close(): Promise<void> {
    this._clearTimer();
    await this.flush().catch(() => { /* best-effort on shutdown */ });
  }
}
