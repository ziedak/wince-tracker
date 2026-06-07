/**
 * SDK-internal diagnostic logger.
 * Writes to console only when WINCE_DEBUG is truthy — never ships data anywhere.
 * Use this for SDK-internal diagnostics, not for user-facing log capture.
 */
export interface DiagnosticLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /** Always logs to console regardless of the debug flag */
  critical(...args: unknown[]): void;
  /** Create a namespaced child logger */
  create(subPrefix: string): DiagnosticLogger;
}

function _make(prefix: string, forceEnabled: boolean): DiagnosticLogger {
  const active = (): boolean =>
    forceEnabled ||
    (typeof globalThis !== 'undefined' &&
      !!(globalThis as Record<string, unknown>)['WINCE_DEBUG']);

  return {
    debug:    (...a) => { if (active()) console.debug(prefix, ...a); },
    info:     (...a) => { if (active()) console.info(prefix, ...a); },
    warn:     (...a) => { if (active()) console.warn(prefix, ...a); },
    error:    (...a) => { if (active()) console.error(prefix, ...a); },
    critical: (...a) => { console.error(prefix, ...a); },
    create:   (sub)  => _make(`${prefix}[${sub}]`, forceEnabled),
  };
}

/** Create a debug-gated SDK logger. Pass debug=true to force-enable output. */
export function createDiagnosticLogger(prefix: string, debug = false): DiagnosticLogger {
  return _make(`[wince:${prefix}]`, debug);
}
