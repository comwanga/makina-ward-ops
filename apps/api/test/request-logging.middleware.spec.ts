import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { RequestLoggingMiddleware } from "../src/common/request-logging.middleware";

function makeReq(url: string, method = "GET"): IncomingMessage {
  return { url, method, headers: {} } as unknown as IncomingMessage;
}

function makeRes(): ServerResponse & EventEmitter {
  const res = new EventEmitter() as unknown as ServerResponse & EventEmitter;
  (res as unknown as { statusCode: number }).statusCode = 200;
  return res;
}

describe("RequestLoggingMiddleware", () => {
  let middleware: RequestLoggingMiddleware;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    middleware = new RequestLoggingMiddleware();
    logSpy = vi.spyOn((middleware as unknown as { logger: { log: (...a: unknown[]) => void } }).logger, "log");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs method, path, status and duration on finish", () => {
    const req = makeReq("/api/v1/staff", "POST");
    const res = makeRes();
    const next = vi.fn();
    middleware.use(req, res as ServerResponse, next);
    expect(next).toHaveBeenCalledTimes(1);
    res.emit("finish");
    const [message] = logSpy.mock.calls[0];
    expect(String(message)).toMatch(/^POST \/api\/v1\/staff 200 \d+\.\dms$/);
  });

  it("skips health readiness paths", () => {
    const req = makeReq("/health/ready");
    const res = makeRes();
    const next = vi.fn();
    middleware.use(req, res as ServerResponse, next);
    expect(next).toHaveBeenCalledTimes(1);
    res.emit("finish");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("skips health liveness paths", () => {
    const req = makeReq("/health/live");
    const res = makeRes();
    const next = vi.fn();
    middleware.use(req, res as ServerResponse, next);
    res.emit("finish");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("strips query strings before logging", () => {
    const req = makeReq("/api/v1/attendance?token=secret");
    const res = makeRes();
    middleware.use(req, res as ServerResponse, vi.fn());
    res.emit("finish");
    const [message] = logSpy.mock.calls[0];
    expect(String(message)).not.toContain("token=");
  });
});