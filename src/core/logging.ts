/**
 * Structured logger for ACCORD.
 *
 * All log output goes to stderr so it never pollutes LLM-visible content.
 * Each message is prefixed with `[accord:<level>]` for easy filtering.
 *
 * Levels (lowest → highest): debug, info, warn, error
 * Setting a level silences everything below it.
 * Default: "error" — only failures are logged unless explicitly enabled.
 *
 * Architecture: LogContext holds its own level so multiple extensions in the
 * same process cannot interfere. A default context is exported for convenience;
 * module-level `setLogLevel`/`getLogLevel` operate on it.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

function fmt(level: string, tag: string, message: string): string {
  return `[accord:${tag}:${level}] ${message}`;
}

/**
 * Isolated logging context. Each extension instance should create its own
 * via `createLogContext()` so level changes don't bleed across instances.
 */
export class LogContext {
  private level: LogLevel = "error";

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  createLogger(tag: string): Logger {
    return {
      debug: (message: string) => {
        if (this.shouldLog("debug")) console.error(fmt("debug", tag, message));
      },
      info: (message: string) => {
        if (this.shouldLog("info")) console.error(fmt("info", tag, message));
      },
      warn: (message: string) => {
        if (this.shouldLog("warn")) console.error(fmt("warn", tag, message));
      },
      error: (message: string) => {
        if (this.shouldLog("error")) console.error(fmt("error", tag, message));
      },
    };
  }
}

export function createLogContext(): LogContext {
  return new LogContext();
}

// ── Default context (backwards-compatible module-level API) ──────────

const defaultContext = new LogContext();

export function setLogLevel(level: LogLevel): void {
  defaultContext.setLevel(level);
}

export function getLogLevel(): LogLevel {
  return defaultContext.getLevel();
}

/**
 * Create a tagged logger bound to the default context.
 * The tag appears in every line for filtering:
 *   [accord:hooks:info] remapping model ...
 *   [accord:usage:error] failed to write usage line
 */
export function createLogger(tag: string): Logger {
  return defaultContext.createLogger(tag);
}

/**
 * Resolve log level from ACCORD config or environment.
 * Precedence: ACCORD_LOG_LEVEL env > config > default ("error").
 */
export function resolveLogLevel(configLevel?: string | null): LogLevel {
  const env = process.env.ACCORD_LOG_LEVEL?.trim().toLowerCase();
  const candidate = env || configLevel || "error";
  if (candidate in LEVEL_ORDER) return candidate as LogLevel;
  return "error";
}
