import { describe, it, expect, vi, afterEach } from "vitest";
import { logger, runWithContext, getCorrelationId, formatLogEntry } from "../lib/logger";
import { correlationIdMiddleware } from "../app";
import type { Request, Response } from "express";

describe("structured logger (Issue #377)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats log entries with ISO timestamp, level, message, and metadata", () => {
    const entry = formatLogEntry("info", "test message", {
      userId: "123",
      status: "active",
    });

    expect(entry.level).toBe("info");
    expect(entry.message).toBe("test message");
    expect(entry.userId).toBe("123");
    expect(entry.status).toBe("active");
    expect(typeof entry.timestamp).toBe("string");
    expect(new Date(entry.timestamp as string).getTime()).not.toBeNaN();
  });

  it("includes correlation ID from async execution context", () => {
    const testCorrelationId = "corr-12345";

    runWithContext({ correlationId: testCorrelationId }, () => {
      expect(getCorrelationId()).toBe(testCorrelationId);
      const entry = formatLogEntry("warn", "contextual warning");
      expect(entry.correlationId).toBe(testCorrelationId);
    });
  });

  it("allows explicit correlationId in metadata to override context", () => {
    runWithContext({ correlationId: "parent-id" }, () => {
      const entry = formatLogEntry("error", "specific error", {
        correlationId: "child-id",
      });
      expect(entry.correlationId).toBe("child-id");
    });
  });

  it("serializes Error instances in metadata cleanly", () => {
    const err = new Error("Database connection lost");
    const entry = formatLogEntry("error", "database failure", { error: err });

    expect(entry.error).toMatchObject({
      name: "Error",
      message: "Database connection lost",
    });
    expect(typeof (entry.error as { stack?: string }).stack).toBe("string");
  });

  it("outputs valid parseable JSON to stdout on info/warn and stderr on error", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.info("info test", { foo: "bar" });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const infoPayload = JSON.parse(logSpy.mock.calls[0][0]);
    expect(infoPayload.level).toBe("info");
    expect(infoPayload.foo).toBe("bar");

    logger.warn("warning test", { alert: true });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnPayload = JSON.parse(warnSpy.mock.calls[0][0]);
    expect(warnPayload.level).toBe("warn");
    expect(warnPayload.alert).toBe(true);

    logger.error("error test", { failure: true });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const errorPayload = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(errorPayload.level).toBe("error");
    expect(errorPayload.failure).toBe(true);
  });
});

describe("correlationIdMiddleware", () => {
  it("propagates existing X-Correlation-ID header and attaches to res", () => {
    const req = {
      headers: { "x-correlation-id": "client-correlation-abc" },
    } as unknown as Request;
    const res = {
      setHeader: vi.fn(),
      locals: {},
    } as unknown as Response;
    const next = vi.fn(() => {
      // Inside next(), the AsyncLocalStorage context should be populated
      expect(getCorrelationId()).toBe("client-correlation-abc");
    });

    correlationIdMiddleware()(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith("X-Correlation-ID", "client-correlation-abc");
    expect(res.locals.correlationId).toBe("client-correlation-abc");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("generates a new UUID correlationId if header is absent", () => {
    const req = { headers: {} } as unknown as Request;
    const res = {
      setHeader: vi.fn(),
      locals: {},
    } as unknown as Response;
    const next = vi.fn(() => {
      expect(getCorrelationId()).toBeDefined();
    });

    correlationIdMiddleware()(req, res, next);

    expect(res.setHeader).toHaveBeenCalledTimes(1);
    expect(res.setHeader).toHaveBeenCalledWith(
      "X-Correlation-ID",
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
