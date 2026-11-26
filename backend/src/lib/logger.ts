/**
 * logger.ts
 *
 * Structured JSON logging with correlation ID propagation.
 * Formats logs as single-line JSON objects with ISO timestamp, log level,
 * message, correlation ID, and arbitrary contextual metadata.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogContext {
  correlationId?: string;
  [key: string]: unknown;
}

const asyncLocalStorage = new AsyncLocalStorage<LogContext>();

/** Get the current correlation ID from active context. */
export function getCorrelationId(): string | undefined {
  return asyncLocalStorage.getStore()?.correlationId;
}

/** Execute a function within a logging context containing correlation ID. */
export function runWithContext<T>(context: LogContext, fn: () => T): T {
  return asyncLocalStorage.run(context, fn);
}

/** Format a log record into a structured JSON-serializable object. */
export function formatLogEntry(
  level: LogLevel,
  message: string,
  metadata?: Record<string, unknown>,
): Record<string, unknown> {
  const store = asyncLocalStorage.getStore();
  const correlationId =
    (metadata?.correlationId as string | undefined) ?? store?.correlationId;

  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(correlationId ? { correlationId } : {}),
  };

  if (store) {
    for (const [key, val] of Object.entries(store)) {
      if (key !== "correlationId" && val !== undefined) {
        entry[key] = val;
      }
    }
  }

  if (metadata) {
    for (const [key, val] of Object.entries(metadata)) {
      if (key !== "correlationId" && val !== undefined) {
        if (val instanceof Error) {
          entry[key] = {
            name: val.name,
            message: val.message,
            stack: val.stack,
          };
        } else {
          entry[key] = val;
        }
      }
    }
  }

  return entry;
}

/** Emit a structured log entry as a JSON string to stdout/stderr. */
export function log(
  level: LogLevel,
  message: string,
  metadata?: Record<string, unknown>,
): string {
  const entry = formatLogEntry(level, message, metadata);
  const json = JSON.stringify(entry);

  if (level === "error") {
    console.error(json);
  } else if (level === "warn") {
    console.warn(json);
  } else {
    console.log(json);
  }

  return json;
}

export const logger = {
  info: (message: string, metadata?: Record<string, unknown>) => log("info", message, metadata),
  warn: (message: string, metadata?: Record<string, unknown>) => log("warn", message, metadata),
  error: (message: string, metadata?: Record<string, unknown>) => log("error", message, metadata),
  debug: (message: string, metadata?: Record<string, unknown>) => log("debug", message, metadata),
  runWithContext,
  getCorrelationId,
  formatLogEntry,
  randomCorrelationId: () => randomUUID(),
};
