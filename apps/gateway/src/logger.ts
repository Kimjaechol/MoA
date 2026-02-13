/**
 * Structured Logger
 *
 * JSON-formatted logging with levels, timestamps, and context.
 * Production: info+  |  Development: debug+
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3,
};

const minLevel: LogLevel = process.env.NODE_ENV === "production" ? "info" : "debug";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...context,
  };

  const line = JSON.stringify(entry);

  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => log("debug", msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => log("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => log("error", msg, ctx),
};
