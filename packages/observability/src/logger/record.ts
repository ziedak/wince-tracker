import type {
  LogFields,
  LogLevel,
  LogOptions,
  LogRecord,
  LogSeverityText,
  Resource,
  SerializedError,
} from './logger.type';

const SEVERITY_TEXT: Partial<Record<number, LogSeverityText>> = {
  1:  'TRACE',
  5:  'DEBUG',
  9:  'INFO',
  13: 'WARN',
  17: 'ERROR',
  21: 'FATAL',
};

let _seq = 0;

function generateId(): string {
  return `${Date.now().toString(36)}-${((++_seq) & 0xffff).toString(36)}`;
}

/** Current wall-clock time as a uint64-nanos string. Avoids JS Number overflow. */
export function timestampNano(): string {
  return `${Date.now()}000000`;
}

/**
 * Recursively serialize an Error, walking the ES2022 .cause chain up to 5 levels.
 * Each level captures name, message, and stack so nothing is silently lost.
 */
export function serializeError(err: Error, depth = 0): SerializedError {
  const result: SerializedError = {
    name: err.name,
    message: err.message,
    stack: err.stack,
  };
  if (depth < 5 && err.cause instanceof Error) {
    result.cause = serializeError(err.cause as Error, depth + 1);
  }
  return result;
}

/**
 * Build and freeze a LogRecord at capture time.
 * contextFields come first; user-provided options.fields override on conflict.
 * Both fields and resource sub-objects are also frozen.
 */
export function buildLogRecord(
  level: LogLevel,
  message: string,
  options: LogOptions,
  contextFields: LogFields,
  resource: Resource,
): LogRecord {
  const obj: {
    id: string;
    timestampNano: string;
    severityNumber: LogLevel;
    severityText: LogSeverityText;
    message: string;
    fields: Readonly<LogFields>;
    resource: Readonly<Resource>;
    error?: SerializedError;
    traceId?: string;
    spanId?: string;
  } = {
    id:             generateId(),
    timestampNano:  timestampNano(),
    severityNumber: level,
    severityText:   SEVERITY_TEXT[level] ?? 'INFO',
    message,
    fields:   Object.freeze<LogFields>({ ...contextFields, ...(options.fields ?? {}) }),
    resource: Object.freeze<Resource>({ ...resource }),
  };

  if (options.error   != null) obj.error   = serializeError(options.error);
  if (options.traceId != null) obj.traceId = options.traceId;
  if (options.spanId  != null) obj.spanId  = options.spanId;

  return Object.freeze(obj) as unknown as LogRecord;
}
