import { IS_DEV, PERSIST_DEBUG_LOGS } from './env';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  subsystem: string;
  message: string;
  metadata?: Record<string, unknown>;
  error?: SerializedError;
}

interface LoggerRuntimeOptions {
  mode: 'development' | 'production';
  persistDebug: boolean;
}

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PATTERN =
  /(token|password|secret|authorization|credential|cookie|vault|api[-_]?key)/i;

function getDefaultRuntimeOptions(): LoggerRuntimeOptions {
  return {
    mode: IS_DEV ? 'development' : 'production',
    persistDebug: IS_DEV && PERSIST_DEBUG_LOGS,
  };
}

let runtimeOptions: LoggerRuntimeOptions = getDefaultRuntimeOptions();
let queue: string[] = [];
let flushPromise: Promise<void> | null = null;
let internalError = false;

function consoleEnabled(level: LogLevel): boolean {
  if (runtimeOptions.mode === 'development') {
    return true;
  }
  return level === 'warn' || level === 'error';
}

function persistedEnabled(level: LogLevel): boolean {
  if (level === 'debug') {
    return runtimeOptions.persistDebug;
  }
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isErrorLike(value: unknown): value is Error {
  return value instanceof Error;
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, current) => {
      if (typeof current === 'object' && current !== null) {
        if (seen.has(current)) {
          return '[Circular]';
        }
        seen.add(current);
      }
      return current;
    });
  } catch {
    return String(value);
  }
}

function sanitizeValue(
  value: unknown,
  key?: string,
  depth: number = 0,
): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) {
    return REDACTED;
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }

  if (isErrorLike(value)) {
    return serializeError(value);
  }

  if (depth >= 4) {
    return '[MaxDepth]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, undefined, depth + 1));
  }

  if (isPlainObject(value)) {
    const sanitized: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      sanitized[entryKey] = sanitizeValue(entryValue, entryKey, depth + 1);
    }
    return sanitized;
  }

  return String(value);
}

function serializeError(error: Error): SerializedError {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

function normalizeArgs(
  message: string,
  errorOrMeta?: unknown,
  maybeMeta?: Record<string, unknown>,
): Pick<LogEntry, 'message' | 'metadata' | 'error'> {
  let error: SerializedError | undefined;
  let metadata: Record<string, unknown> | undefined;

  if (isErrorLike(errorOrMeta)) {
    error = serializeError(errorOrMeta);
    metadata = maybeMeta
      ? (sanitizeValue(maybeMeta) as Record<string, unknown>)
      : undefined;
  } else if (errorOrMeta !== undefined) {
    if (isPlainObject(errorOrMeta)) {
      metadata = sanitizeValue(errorOrMeta) as Record<string, unknown>;
    } else {
      metadata = {
        value: sanitizeValue(errorOrMeta),
      };
    }
  }

  return { message, metadata, error };
}

function formatConsolePrefix(entry: LogEntry): string {
  return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.subsystem}] ${entry.message}`;
}

function getConsoleMethod(level: LogLevel): (...data: unknown[]) => void {
  switch (level) {
    case 'debug':
      return console.debug.bind(console);
    case 'info':
      return console.info.bind(console);
    case 'warn':
      return console.warn.bind(console);
    case 'error':
      return console.error.bind(console);
  }
}

function emitConsole(entry: LogEntry): void {
  if (!consoleEnabled(entry.level)) {
    return;
  }

  const method = getConsoleMethod(entry.level);
  const args: unknown[] = [formatConsolePrefix(entry)];
  if (entry.metadata !== undefined) {
    args.push(entry.metadata);
  }
  if (entry.error !== undefined) {
    args.push(entry.error);
  }
  method(...args);
}

/**
 * Host-installed sink that persists serialized log lines (the desktop app
 * appends to the log file). Installed once at bootstrap; entries queue until
 * then.
 */
export type LogSink = (lines: string[]) => Promise<void>;

let logSink: LogSink | null = null;

/** Install the host's log sink. Called once at bootstrap. */
export function setLogSink(sink: LogSink | null): void {
  logSink = sink;
  if (sink && queue.length > 0) {
    scheduleFlush();
  }
}

function scheduleFlush(): void {
  if (flushPromise) {
    return;
  }

  flushPromise = (async () => {
    // Entries logged while modules are still importing (before bootstrap
    // installs the sink) stay queued; the next log call re-flushes them.
    while (queue.length > 0 && logSink !== null) {
      const batch = queue;
      queue = [];
      try {
        await logSink(batch);
      } catch (error) {
        if (!internalError) {
          internalError = true;
          try {
            console.error('[Logger] failed to flush logs', error);
          } finally {
            internalError = false;
          }
        }
      }
    }
  })().finally(() => {
    flushPromise = null;
    if (queue.length > 0 && logSink !== null) {
      scheduleFlush();
    }
  });
}

function persistEntry(entry: LogEntry): void {
  if (!persistedEnabled(entry.level)) {
    return;
  }

  try {
    queue.push(safeStringify(entry));
    scheduleFlush();
  } catch (error) {
    if (internalError) {
      return;
    }
    internalError = true;
    try {
      console.error('[Logger] failed to queue log entry', error);
    } finally {
      internalError = false;
    }
  }
}

function emitEntry(entry: LogEntry): void {
  try {
    emitConsole(entry);
  } catch {
    // Swallow console failures. Logging must not break app code.
  }

  persistEntry(entry);
}

function createEntry(
  level: LogLevel,
  subsystem: string,
  message: string,
  errorOrMeta?: unknown,
  maybeMeta?: Record<string, unknown>,
): LogEntry {
  const normalized = normalizeArgs(message, errorOrMeta, maybeMeta);
  return {
    timestamp: new Date().toISOString(),
    level,
    subsystem,
    message: normalized.message,
    metadata: normalized.metadata,
    error: normalized.error,
  };
}

/**
 * Host-installed reporter for `error`-level log entries (the desktop app
 * forwards to PostHog error tracking). Without one, error reporting is a
 * no-op; console/persisted logging is unaffected.
 */
export type LogErrorReporter = (
  error: Error,
  context: Record<string, unknown>,
) => void;

let errorReporter: LogErrorReporter | null = null;

/** Install the host's error reporter. Called once at bootstrap. */
export function setLogErrorReporter(reporter: LogErrorReporter | null): void {
  errorReporter = reporter;
}

function reportError(
  subsystem: string,
  message: string,
  errorOrMeta?: unknown,
  maybeMeta?: Record<string, unknown>,
): void {
  if (!errorReporter) {
    return;
  }

  try {
    if (isErrorLike(errorOrMeta)) {
      errorReporter(errorOrMeta, {
        subsystem,
        message,
        ...(maybeMeta ?? {}),
      });
      return;
    }

    const extra = isPlainObject(errorOrMeta) ? errorOrMeta : {};
    errorReporter(new Error(message), {
      subsystem,
      ...extra,
      ...(maybeMeta ?? {}),
    });
  } catch {
    // Swallow reporter failures. Logging must not break app code.
  }
}

export class Logger {
  public constructor(private readonly subsystem: string) {}

  public debug(message: string, metadata?: Record<string, unknown>): void {
    emitEntry(createEntry('debug', this.subsystem, message, metadata));
  }

  public info(message: string, metadata?: Record<string, unknown>): void {
    emitEntry(createEntry('info', this.subsystem, message, metadata));
  }

  public warn(
    message: string,
    errorOrMeta?: unknown,
    maybeMeta?: Record<string, unknown>,
  ): void {
    emitEntry(
      createEntry('warn', this.subsystem, message, errorOrMeta, maybeMeta),
    );
  }

  public error(
    message: string,
    errorOrMeta?: unknown,
    maybeMeta?: Record<string, unknown>,
  ): void {
    emitEntry(
      createEntry('error', this.subsystem, message, errorOrMeta, maybeMeta),
    );
    reportError(this.subsystem, message, errorOrMeta, maybeMeta);
  }
}

export async function flushLogs(): Promise<void> {
  // Entries queued before the sink was installed have no flush scheduled
  // yet; kick one off so a post-bootstrap flush drains them.
  if (queue.length > 0) {
    scheduleFlush();
  }
  while (flushPromise) {
    await flushPromise;
  }
}

export function resetLoggingForTests(options?: Partial<LoggerRuntimeOptions>) {
  runtimeOptions = {
    ...getDefaultRuntimeOptions(),
    ...options,
  };
  queue = [];
  flushPromise = null;
  internalError = false;
}
