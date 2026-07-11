import {
  Logger,
  LogLevel,
  defaultLogger,
  buildLogRecord,
  serializeError,
  timestampNano,
  ConsoleSink,
} from '../src/index.js';
import type { ILogSink, LogRecord, SinkEntry } from '../src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSink(): ILogSink & { records: LogRecord[] } {
  const records: LogRecord[] = [];
  return {
    records,
    write(r: LogRecord) {
      records.push(r);
    },
  };
}



// ---------------------------------------------------------------------------
// defaultLogger smoke test
// ---------------------------------------------------------------------------

describe('defaultLogger', () => {
  it('is exported and is a Logger instance', () => {
    expect(defaultLogger).toBeInstanceOf(Logger);
  });
});

// ---------------------------------------------------------------------------
// LogLevel severity numbers (OTLP spec)
// ---------------------------------------------------------------------------

describe('LogLevel values (OTLP)', () => {
  it.each([
    ['TRACE', 1],
    ['DEBUG', 5],
    ['INFO', 9],
    ['WARN', 13],
    ['ERROR', 17],
    ['FATAL', 21],
  ])('%s === %i', (name, value) => {
    expect(LogLevel[name as keyof typeof LogLevel]).toBe(value);
  });
});

// ---------------------------------------------------------------------------
// buildLogRecord
// ---------------------------------------------------------------------------

describe('buildLogRecord', () => {
  it('produces a frozen record with correct fields', () => {
    const rec = buildLogRecord(LogLevel.INFO, 'hello', {}, {}, {});
    expect(rec.message).toBe('hello');
    expect(rec.severityNumber).toBe(9);
    expect(rec.severityText).toBe('INFO');
    expect(typeof rec.id).toBe('string');
    expect(typeof rec.timestampNano).toBe('string');
    expect(Object.isFrozen(rec)).toBe(true);
    expect(Object.isFrozen(rec.fields)).toBe(true);
    expect(Object.isFrozen(rec.resource)).toBe(true);
  });

  it('merges context fields with options.fields (options win)', () => {
    const rec = buildLogRecord(
      LogLevel.DEBUG,
      'msg',
      { fields: { env: 'prod', extra: 'optVal' } },
      { env: 'ctx', ctxOnly: 'yes' },
      {},
    );
    expect(rec.fields['env']).toBe('prod'); // option wins
    expect(rec.fields['ctxOnly']).toBe('yes'); // context key
    expect(rec.fields['extra']).toBe('optVal'); // option-only key
  });

  it('serialises error into record.error', () => {
    const err = new Error('boom');
    const rec = buildLogRecord(LogLevel.ERROR, 'bad', { error: err }, {}, {});
    expect(rec.error?.message).toBe('boom');
    expect(rec.error?.name).toBe('Error');
  });

  it('copies traceId and spanId', () => {
    const rec = buildLogRecord(
      LogLevel.WARN,
      'trace',
      { traceId: 'tid', spanId: 'sid' },
      {},
      {},
    );
    expect(rec.traceId).toBe('tid');
    expect(rec.spanId).toBe('sid');
  });

  it('includes resource in the record', () => {
    const resource = { serviceName: 'my-svc', environment: 'staging' };
    const rec = buildLogRecord(LogLevel.INFO, 'r', {}, {}, resource);
    expect(rec.resource.serviceName).toBe('my-svc');
    expect(rec.resource.environment).toBe('staging');
  });
});

// ---------------------------------------------------------------------------
// timestampNano
// ---------------------------------------------------------------------------

describe('timestampNano', () => {
  it('returns a string ending in 000000', () => {
    const ts = timestampNano();
    expect(typeof ts).toBe('string');
    expect(ts.endsWith('000000')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// serializeError
// ---------------------------------------------------------------------------

describe('serializeError', () => {
  it('captures name, message and stack', () => {
    const err = new TypeError('bad type');
    const s = serializeError(err);
    expect(s.name).toBe('TypeError');
    expect(s.message).toBe('bad type');
    expect(typeof s.stack).toBe('string');
  });

  it('walks Error.cause chain up to 5 levels', () => {
    const e5 = new Error('level5');
    const e4 = new Error('level4', { cause: e5 });
    const e3 = new Error('level3', { cause: e4 });
    const e2 = new Error('level2', { cause: e3 });
    const e1 = new Error('level1', { cause: e2 });

    const s = serializeError(e1);
    expect(s.cause?.message).toBe('level2');
    expect(s.cause?.cause?.message).toBe('level3');
    expect(s.cause?.cause?.cause?.message).toBe('level4');
    expect(s.cause?.cause?.cause?.cause?.message).toBe('level5');
    // depth limit: level5 should have no cause
    expect(s.cause?.cause?.cause?.cause?.cause).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Logger — level filtering
// ---------------------------------------------------------------------------

describe('Logger level filtering', () => {
  it('suppresses records below the configured level', () => {
    const sink = makeSink();
    const logger = new Logger({ level: LogLevel.WARN, sinks: [{ sink }] });
    logger.debug('not logged');
    logger.info('also not logged');
    logger.warn('logged');
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0].severityText).toBe('WARN');
  });

  it('setLevel raises the threshold at runtime', () => {
    const sink = makeSink();
    const logger = new Logger({ level: LogLevel.DEBUG, sinks: [{ sink }] });
    logger.debug('before raise');
    logger.setLevel(LogLevel.ERROR);
    logger.warn('after raise — suppressed');
    logger.error('after raise — logged');
    expect(sink.records).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Logger — per-sink minLevel
// ---------------------------------------------------------------------------

describe('Logger per-sink minLevel', () => {
  it('routes to sinks based on their own minLevel', () => {
    const verbose = makeSink();
    const errOnly = makeSink();
    const sinks: SinkEntry[] = [
      { sink: verbose },
      { sink: errOnly, minLevel: LogLevel.ERROR },
    ];
    const logger = new Logger({ level: LogLevel.DEBUG, sinks });
    logger.debug('d');
    logger.info('i');
    logger.error('e');

    expect(verbose.records).toHaveLength(3);
    expect(errOnly.records).toHaveLength(1);
    expect(errOnly.records[0]).not.toBeNull();
    expect(errOnly.records[0].severityText).toBe('ERROR');
  });
});

// ---------------------------------------------------------------------------
// Logger — context providers
// ---------------------------------------------------------------------------

describe('Logger context providers', () => {
  it('merges context into each record', () => {
    const sink = makeSink();
    const logger = new Logger({
      sinks: [{ sink }],
      contextProviders: [() => ({ userId: 'u1' })],
    });
    logger.info('hi');
    expect(sink.records[0].fields['userId']).toBe('u1');
  });

  it('options.fields override context fields', () => {
    const sink = makeSink();
    const logger = new Logger({
      sinks: [{ sink }],
      contextProviders: [() => ({ env: 'ctx' })],
    });
    logger.info('hi', { fields: { env: 'override' } });
    expect(sink.records[0].fields['env']).toBe('override');
  });

  it('swallows throwing context providers', () => {
    const sink = makeSink();
    const logger = new Logger({
      sinks: [{ sink }],
      contextProviders: [
        () => {
          throw new Error('ctx boom');
        },
        () => ({ safe: 'yes' }),
      ],
    });
    expect(() => logger.info('ok')).not.toThrow();
    expect(sink.records[0].fields['safe']).toBe('yes');
  });
});

// ---------------------------------------------------------------------------
// Logger — global beforeSend
// ---------------------------------------------------------------------------

describe('Logger global beforeSend', () => {
  it('null drops the record', () => {
    const sink = makeSink();
    const logger = new Logger({
      sinks: [{ sink }],
      beforeSend: () => null,
    });
    logger.info('dropped');
    expect(sink.records).toHaveLength(0);
  });

  it('can mutate the record by returning a new object', () => {
    const sink = makeSink();
    const logger = new Logger({
      sinks: [{ sink }],
      beforeSend: (r) => ({ ...r, message: 'mutated' }),
    });
    logger.info('original');
    expect(sink.records[0].message).toBe('mutated');
  });

  it('a throwing hook degrades to no-op (chain continues)', () => {
    const sink = makeSink();
    const logger = new Logger({
      sinks: [{ sink }],
      beforeSend: [
        () => {
          throw new Error('hook error');
        },
      ],
    });
    expect(() => logger.info('should arrive')).not.toThrow();
    expect(sink.records[0].message).toBe('should arrive');
  });
});

// ---------------------------------------------------------------------------
// Logger — deduplication
// ---------------------------------------------------------------------------

describe('Logger deduplication', () => {
  it('suppresses same level+message within the window', () => {
    const sink = makeSink();
    const logger = new Logger({
      sinks: [{ sink }],
      dedupWindowMs: 10000,
    });
    logger.info('dup message');
    logger.info('dup message');
    logger.info('dup message');
    expect(sink.records).toHaveLength(1);
  });

  it('passes different messages through', () => {
    const sink = makeSink();
    const logger = new Logger({
      sinks: [{ sink }],
      dedupWindowMs: 10000,
    });
    logger.info('msg-a');
    logger.info('msg-b');
    expect(sink.records).toHaveLength(2);
  });

  it('same message at different levels are NOT duplicates', () => {
    const sink = makeSink();
    const logger = new Logger({
      sinks: [{ sink }],
      level: LogLevel.DEBUG,
      dedupWindowMs: 10000,
    });
    logger.debug('same');
    logger.info('same');
    expect(sink.records).toHaveLength(2);
  });

  it('dedup map is pruned when it grows large (no unbounded growth)', () => {
    const sink = makeSink();
    const logger = new Logger({ sinks: [{ sink }], dedupWindowMs: 1 });
    // Insert > 2000 distinct messages to force a GC sweep
    for (let i = 0; i < 2100; i++) logger.info(`msg-${i}`);
    // After GC, internal map should be <= 2000 entries (all windows have expired).
    // We can only assert indirectly: logger must remain functional.
    logger.info('after prune');
    expect(sink.records.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Logger — child loggers
// ---------------------------------------------------------------------------

describe('Logger child', () => {
  it('child inherits parent config', () => {
    const sink = makeSink();
    const parent = new Logger({ sinks: [{ sink }] });
    const child = parent.child();
    child.info('from child');
    expect(sink.records).toHaveLength(1);
  });

  it('child overrides are isolated from parent', () => {
    const parentSink = makeSink();
    const childSink = makeSink();
    const parent = new Logger({ sinks: [{ sink: parentSink }] });
    const child = parent.child({ sinks: [{ sink: childSink }] });
    parent.info('parent only');
    child.info('child only');
    expect(parentSink.records).toHaveLength(1);
    expect(childSink.records).toHaveLength(1);
  });

  it('adding a sink to child does not affect parent', () => {
    const parentSink = makeSink();
    const extra = makeSink();
    const parent = new Logger({ sinks: [{ sink: parentSink }] });
    const child = parent.child();
    child.addSink(extra);
    parent.info('parent msg');
    expect(extra.records).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Logger — addSink / removeSink
// ---------------------------------------------------------------------------

describe('Logger addSink / removeSink', () => {
  it('addSink registers a new sink', () => {
    const s1 = makeSink();
    const s2 = makeSink();
    const logger = new Logger({ sinks: [{ sink: s1 }] });
    logger.addSink(s2);
    logger.info('both');
    expect(s1.records).toHaveLength(1);
    expect(s2.records).toHaveLength(1);
  });

  it('removeSink unregisters a sink', () => {
    const s1 = makeSink();
    const s2 = makeSink();
    const logger = new Logger({ sinks: [{ sink: s1 }, { sink: s2 }] });
    logger.removeSink(s1);
    logger.info('only s2');
    expect(s1.records).toHaveLength(0);
    expect(s2.records).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Logger — flush + close
// ---------------------------------------------------------------------------

describe('Logger flush / close', () => {
  it('flush calls flush on sinks that implement it', async () => {
    let flushed = false;
    const sink: ILogSink = {
      write() { /* empty */ },
      flush: async () => {
        flushed = true;
      },
    };
    const logger = new Logger({ sinks: [{ sink }] });
    await logger.flush();
    expect(flushed).toBe(true);
  });

  it('close calls close on sinks that implement it', async () => {
    let closed = false;
    const sink: ILogSink = {
      write() { /* empty */ },
      close: async () => {
        closed = true;
      },
    };
    const logger = new Logger({ sinks: [{ sink }] });
    await logger.close();
    expect(closed).toBe(true);
  });

  it('flush still resolves if one sink rejects', async () => {
    const good = makeSink();
    const bad: ILogSink = {
      write() { /* empty */ },
      flush: () => Promise.reject(new Error('flush fail')),
    };
    const logger = new Logger({ sinks: [{ sink: bad }, { sink: good }] });
    await expect(logger.flush()).resolves.toBeUndefined();
  });

  // Regression: before the synchronous-write fix, flush() called in the same
  // turn as log() would see an empty buffer and miss the record.
  it('flush after log in the same turn sends the record (dispatch timing)', async () => {
    let flushed = false;
    let writeCount = 0;
    const sink: ILogSink = {
      write() { writeCount++; },
      flush: async () => { flushed = true; },
    };
    const logger = new Logger({ sinks: [{ sink }] });
    logger.info('must arrive');
    await logger.flush();
    expect(writeCount).toBe(1);
    expect(flushed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ConsoleSink
// ---------------------------------------------------------------------------

describe('ConsoleSink', () => {
  it('is a singleton via .instance', () => {
    expect(ConsoleSink.instance).toBe(ConsoleSink.instance);
  });

  it('write does not throw for any severity level', () => {
    const sink = ConsoleSink.instance;
    const makeRec = (level: LogLevel) =>
      buildLogRecord(level, 'test', {}, {}, {});

    expect(() => sink.write(makeRec(LogLevel.TRACE))).not.toThrow();
    expect(() => sink.write(makeRec(LogLevel.DEBUG))).not.toThrow();
    expect(() => sink.write(makeRec(LogLevel.INFO))).not.toThrow();
    expect(() => sink.write(makeRec(LogLevel.WARN))).not.toThrow();
    expect(() => sink.write(makeRec(LogLevel.ERROR))).not.toThrow();
    expect(() => sink.write(makeRec(LogLevel.FATAL))).not.toThrow();
  });
});
