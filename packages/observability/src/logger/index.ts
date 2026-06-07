// Core types
export {
  LogLevel,
  type LogSeverityText,
  type LogAttributeValue,
  type LogFields,
  type Resource,
  type SerializedError,
  type LogRecord,
  type LogOptions,
  type ILogSink,
  type SinkEntry,
  type BeforeSendFn,
  type ContextProvider,
} from './logger.type';

// Record helpers
export { buildLogRecord, serializeError, timestampNano } from './record';

// Logger
export { Logger, defaultLogger, type ILogger, type LoggerOptions } from './logger';

// Sinks
export { ConsoleSink } from './sinks/ConsoleSink';
export { OtlpHttpSink, type OtlpHttpSinkOptions } from './sinks/OtlpHttpSink';

// Internal diagnostic logger (for SDK authors)
export { createDiagnosticLogger, type DiagnosticLogger } from './DiagnosticLogger';

// Backward-compat aliases
export { ConsoleSink as ConsoleLogSink } from './sinks/ConsoleSink';
