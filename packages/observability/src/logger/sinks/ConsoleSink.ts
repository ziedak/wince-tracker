import { LogLevel, type ILogSink, type LogRecord } from '../logger.type';

/** Fixed-width labels for column-aligned console output */
const LABELS: Partial<Record<number, string>> = {
  [LogLevel.TRACE]: 'TRACE',
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]:  'INFO ',
  [LogLevel.WARN]:  'WARN ',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.FATAL]: 'FATAL',
};

export class ConsoleSink implements ILogSink {
  static readonly instance = new ConsoleSink();

  write(record: LogRecord): void {
    const label = LABELS[record.severityNumber] ?? record.severityText;
    // Decode nanos back to ms: our format is `${ms}000000`, so slice the last 6 digits
    const ms = Number(record.timestampNano.slice(0, -6));
    const ts = new Date(ms).toISOString();
    const prefix = `[${ts}] [${label}]`;

    const extras: unknown[] = [];
    if (Object.keys(record.fields).length > 0) extras.push(record.fields);
    if (record.error) extras.push(record.error);

    if (record.severityNumber >= LogLevel.ERROR) {
      console.error(prefix, record.message, ...extras);
    } else if (record.severityNumber >= LogLevel.WARN) {
      console.warn(prefix, record.message, ...extras);
    } else if (record.severityNumber >= LogLevel.INFO) {
      console.info(prefix, record.message, ...extras);
    } else if (record.severityNumber >= LogLevel.DEBUG) {
      console.debug(prefix, record.message, ...extras);
    } else {
      console.log(prefix, record.message, ...extras);
    }
  }

  async flush(): Promise<void> { /* no-op: console is synchronous */ }
  async close(): Promise<void> { /* no-op: console has no resources */ }
}
