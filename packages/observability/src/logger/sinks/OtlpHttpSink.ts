import { Exporter, HttpSender, type ExporterOptions } from '@wince/transport';
import type { ILogSink, LogAttributeValue, LogRecord, Resource } from '../logger.type';
import { LogLevel } from '../logger.type';

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
// OTLP encoding helpers (the only unique logic in this file)
// ============================================================================

function toOtlpValue(v: LogAttributeValue): OtlpAnyValue {
  if (v === null || v === undefined) return { stringValue: String(v) };
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number') {
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

function buildOtlpPayload(
  batch: LogRecord[],
  scopeName: string,
  scopeVersion?: string,
): OtlpPayload {
  const resource = batch[0]?.resource ?? {};
  return {
    resourceLogs: [{
      resource: { attributes: buildResourceAttrs(resource) },
      scopeLogs: [{
        scope: { name: scopeName, ...(scopeVersion ? { version: scopeVersion } : {}) },
        logRecords: batch.map(encodeRecord),
      }],
    }],
  };
}

// ============================================================================
// Public options
// ============================================================================

export interface OtlpHttpSinkOptions {
  endpoint: string;
  headers?: Record<string, string>;
  scopeName?: string;
  scopeVersion?: string;
  maxBatchSize?: number;
  maxBatchBytes?: number;
  flushIntervalMs?: number;
  maxBufferSize?: number;
  requestTimeoutMs?: number;
  rateLimit?: { bucketSize: number; refillRate: number; refillIntervalMs: number };
  retry?: ExporterOptions<LogRecord>['retry'];
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

// ============================================================================
// Sink — composes Exporter from @wince/transport
// ============================================================================

export class OtlpHttpSink implements ILogSink {
  private readonly _exporter: Exporter<LogRecord>;

  constructor(opts: OtlpHttpSinkOptions) {
    const scopeName    = opts.scopeName    ?? 'wince';
    const scopeVersion = opts.scopeVersion;

    const sender = new HttpSender({
      endpoint:         opts.endpoint,
      headers:          { 'Content-Type': 'application/json', ...opts.headers },
      requestTimeoutMs: opts.requestTimeoutMs,
      fetch:            opts.fetch,
    });

    this._exporter = new Exporter<LogRecord>({
      sender,
      encode:          (batch) => JSON.stringify(buildOtlpPayload(batch, scopeName, scopeVersion)),
      batchSize:       opts.maxBatchSize    ?? 100,
      batchBytes:      opts.maxBatchBytes,
      flushIntervalMs: opts.flushIntervalMs ?? 3_000,
      maxBufferSize:   opts.maxBufferSize   ?? 500,
      rateLimit:       opts.rateLimit,
      retry:           opts.retry,
      onPriorityItem:  (rec) => rec.severityNumber >= LogLevel.ERROR,
    });
  }

  write(record: LogRecord): void {
    this._exporter.enqueue(record);
  }

  async flush(): Promise<void> {
    return this._exporter.flush();
  }

  async close(): Promise<void> {
    return this._exporter.close();
  }
}
