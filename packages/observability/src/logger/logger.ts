import { buildLogRecord } from './record';
import {
  LogLevel,
  type BeforeSendFn,
  type ContextProvider,
  type ILogSink,
  type LogFields,
  type LogOptions,
  type LogRecord,
  type Resource,
  type SinkEntry,
} from './logger.type';
import { ConsoleSink } from './sinks/ConsoleSink';

const SINK_TIMEOUT_MS = 5000;
const DEDUP_MAX_SIZE = 2000;

/**
 * Race a promise against a timeout, always resolving (never rejecting).
 * Clears the timer when the primary promise settles to prevent leaks.
 */
function raceVoid(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    p.then(
      () => { clearTimeout(timer); resolve(); },
      () => { clearTimeout(timer); resolve(); },
    );
  });
}

interface DedupEntry {
  count: number;
  firstSeen: number;
  lastSeen: number;
}

export interface LoggerOptions {
  level?: LogLevel;
  resource?: Resource;
  contextProviders?: ContextProvider[];
  beforeSend?: BeforeSendFn | BeforeSendFn[];
  sinks?: SinkEntry[];
  /** Suppress duplicate (level, message) pairs within this window (ms). 0 = disabled. */
  dedupWindowMs?: number;
}

export interface ILogger {
  trace(message: string, options?: LogOptions): void;
  debug(message: string, options?: LogOptions): void;
  info(message: string, options?: LogOptions): void;
  warn(message: string, options?: LogOptions): void;
  error(message: string, options?: LogOptions): void;
  fatal(message: string, options?: LogOptions): void;
  setLevel(level: LogLevel): void;
  addSink(sink: ILogSink, opts?: { minLevel?: LogLevel }): void;
  removeSink(sink: ILogSink): void;
  child(overrides?: Partial<LoggerOptions>): ILogger;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export class Logger implements ILogger {
  private _level: LogLevel;
  private _resource: Resource;
  private _contextProviders: ContextProvider[];
  private _beforeSendFns: BeforeSendFn[];
  private _sinks: SinkEntry[];
  private _dedupWindowMs: number;
  private readonly _dedup = new Map<string, DedupEntry>();

  constructor(opts: LoggerOptions = {}) {
    this._level = opts.level ?? LogLevel.INFO;
    this._resource = opts.resource ?? {};
    this._contextProviders = opts.contextProviders ? [...opts.contextProviders] : [];
    this._beforeSendFns = opts.beforeSend
      ? Array.isArray(opts.beforeSend) ? [...opts.beforeSend] : [opts.beforeSend]
      : [];
    this._sinks = opts.sinks ? [...opts.sinks] : [{ sink: ConsoleSink.instance }];
    this._dedupWindowMs = opts.dedupWindowMs ?? 0;
  }

  setLevel(level: LogLevel): void {
    this._level = level;
  }

  addSink(sink: ILogSink, opts: { minLevel?: LogLevel } = {}): void {
    this._sinks.push({ sink, minLevel: opts.minLevel });
  }

  removeSink(sink: ILogSink): void {
    this._sinks = this._sinks.filter((e) => e.sink !== sink);
  }

  /** Create a child logger that inherits this logger's config. Overrides shallow-merge. */
  child(overrides: Partial<LoggerOptions> = {}): ILogger {
    return new Logger({
      level:            this._level,
      resource:         { ...this._resource },
      contextProviders: [...this._contextProviders],
      beforeSend:       [...this._beforeSendFns],
      sinks:            [...this._sinks],
      dedupWindowMs:    this._dedupWindowMs,
      ...overrides,
    });
  }

  private _gatherContext(): LogFields {
    const out: LogFields = {};
    for (const fn of this._contextProviders) {
      try {
        Object.assign(out, fn());
      } catch {
        /* context provider failure is non-fatal */
      }
    }
    return out;
  }

  private _applyBeforeSend(record: LogRecord): LogRecord | null {
    let r: LogRecord = record;
    for (const fn of this._beforeSendFns) {
      try {
        const next = fn(r);
        if (next === null) return null;
        r = next;
      } catch {
        /* buggy hook degrades to no-op; chain continues with previous value */
      }
    }
    return r;
  }

  private _isDuplicate(level: LogLevel, message: string): boolean {
    if (this._dedupWindowMs <= 0) return false;
    const key = `${level}:${message}`;
    const now = Date.now();
    const entry = this._dedup.get(key);
    if (entry !== undefined && now - entry.firstSeen < this._dedupWindowMs) {
      entry.count++;
      entry.lastSeen = now;
      return true;
    }
    this._dedup.set(key, { count: 1, firstSeen: now, lastSeen: now });
    // Lazy GC: sweep expired entries when the map grows large to prevent unbounded growth.
    if (this._dedup.size > DEDUP_MAX_SIZE) {
      for (const [k, e] of this._dedup) {
        if (now - e.firstSeen >= this._dedupWindowMs) this._dedup.delete(k);
      }
    }
    return false;
  }

  private _dispatch(level: LogLevel, message: string, options: LogOptions): void {
    if (level < this._level) return;
    if (this._isDuplicate(level, message)) return;

    const context = this._gatherContext();
    const record = buildLogRecord(level, message, options, context, this._resource);

    const globalFiltered = this._applyBeforeSend(record);
    if (globalFiltered === null) return;

    for (const entry of this._sinks) {
      const minLevel = entry.minLevel ?? this._level;
      if (globalFiltered.severityNumber < minLevel) continue;

      let sinkRecord: LogRecord | null = globalFiltered;
      if (entry.sink.beforeSend !== undefined) {
        try {
          sinkRecord = entry.sink.beforeSend(globalFiltered);
        } catch {
          sinkRecord = globalFiltered;
        }
      }
      if (sinkRecord === null) continue;

      // Write synchronously so that flush() called in the same turn sees the record.
      try {
        const p = entry.sink.write(sinkRecord);
        if (p instanceof Promise) {
          p.catch((err: unknown) => {
            try { console.error('[Logger] sink write failed', err); } catch { /* swallow */ }
          });
        }
      } catch (err: unknown) {
        try { console.error('[Logger] sink write failed', err); } catch { /* swallow */ }
      }
    }
  }

  trace(message: string, options: LogOptions = {}): void { this._dispatch(LogLevel.TRACE, message, options); }
  debug(message: string, options: LogOptions = {}): void { this._dispatch(LogLevel.DEBUG, message, options); }
  info(message: string,  options: LogOptions = {}): void { this._dispatch(LogLevel.INFO,  message, options); }
  warn(message: string,  options: LogOptions = {}): void { this._dispatch(LogLevel.WARN,  message, options); }
  error(message: string, options: LogOptions = {}): void { this._dispatch(LogLevel.ERROR, message, options); }
  fatal(message: string, options: LogOptions = {}): void { this._dispatch(LogLevel.FATAL, message, options); }

  async flush(): Promise<void> {
    await Promise.allSettled(
      this._sinks.map(({ sink }) =>
        typeof sink.flush === 'function'
          ? raceVoid(sink.flush(), SINK_TIMEOUT_MS)
          : Promise.resolve()
      )
    );
  }

  async close(): Promise<void> {
    await this.flush();
    await Promise.allSettled(
      this._sinks.map(({ sink }) =>
        typeof sink.close === 'function'
          ? raceVoid(sink.close(), SINK_TIMEOUT_MS)
          : Promise.resolve()
      )
    );
  }
}

export const defaultLogger = new Logger();
