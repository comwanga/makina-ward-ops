import { Injectable, Logger, NestMiddleware } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";

const REQUEST_ID_HEADER = "x-request-id";

const SKIP_PATHS = new Set(["/api/v1/health/live", "/api/v1/health/ready", "/api/v1/health"]);

/**
 * Structured, PII-safe access log. Records method, path, status and duration
 * correlated by the x-request-id header. Never logs request bodies, headers,
 * session tokens, phone numbers or user identifiers so that operational logs
 * stay safe to export (§ DoD security).
 *
 * Runs inside @fastify/middie, which hands middleware the raw Node
 * request/response objects, so the finish listener attaches to the response.
 */
@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger("HTTP");

  use(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    const path = (req.url ?? "").split("?")[0] ?? "";
    if (SKIP_PATHS.has(path)) {
      next();
      return;
    }
    const startedAt = process.hrtime.bigint();
    const requestId = req.headers[REQUEST_ID_HEADER] ?? undefined;
    const finish = () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      this.logger.log(
        `${req.method ?? "?"} ${path} ${res.statusCode} ${durationMs.toFixed(1)}ms`,
        requestId ? `HTTP [${requestId}]` : "HTTP",
      );
    };
    res.once("finish", finish).once("close", finish);
    next();
  }
}