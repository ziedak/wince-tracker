// OTLP-spec severity numbers: TRACE=1, DEBUG=5, INFO=9, WARN=13, ERROR=17, FATAL=21
// Ordering is preserved so `level < minLevel` comparisons remain correct.
export const LogLevel = {
  TRACE: 1,
  DEBUG: 5,
  INFO:  9,
  WARN:  13,
  ERROR: 17,
  FATAL: 21,
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export type LogSeverityText = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export type LogAttributeValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | LogAttributeValue[]
  | { [key: string]: LogAttributeValue };

export type LogFields = Record<string, LogAttributeValue>;

export interface Resource {
  serviceName?: string;
  serviceVersion?: string;
  environment?: string;
  [key: string]: LogAttributeValue | undefined;
}

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedError;
}

/**
 * Canonical internal log record — built and frozen at capture time.
 * This is NOT the OTLP wire format. Each sink encodes it independently.
 */
export interface LogRecord {
  readonly id: string;
  readonly timestampNano: string;        // `${Date.now()}000000` — uint64 nanos as string
  readonly severityNumber: LogLevel;     // OTLP severity number (1/5/9/13/17/21)
  readonly severityText: LogSeverityText;
  readonly message: string;
  readonly fields: Readonly<LogFields>;  // merged: contextProviders + user-provided
  readonly resource: Readonly<Resource>; // baked in at Logger construction time
  readonly error?: SerializedError;      // full cause chain (ES2022 .cause)
  readonly traceId?: string;             // W3C distributed trace correlation
  readonly spanId?: string;
}

/** Options the caller passes at each log call site */
export interface LogOptions {
  fields?: LogFields;
  error?: Error;
  traceId?: string;
  spanId?: string;
}

/** Sink interface — receives a fully-baked, frozen LogRecord */
export interface ILogSink {
  write(record: LogRecord): void | Promise<void>;
  /** Per-sink filter: return (possibly mutated) record to keep, null to drop */
  beforeSend?(record: LogRecord): LogRecord | null;
  flush?(): Promise<void>;
  close?(): Promise<void>;
}

/** Per-sink registration in Logger */
export interface SinkEntry {
  sink: ILogSink;
  /** Only dispatch records at or above this level to this sink */
  minLevel?: LogLevel;
}

/** Global before-send hook: mutate or drop a record before any sink sees it */
export type BeforeSendFn = (record: LogRecord) => LogRecord | null;

/** Returns extra fields merged into every record at capture time */
export type ContextProvider = () => LogFields;