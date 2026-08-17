import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { HealthController } from "../src/health/health.controller";
import { HealthService } from "../src/health/health.service";

describe("HealthController", () => {
  it("reports liveness without dependencies", () => {
    const controller = new HealthController({} as HealthService);
    expect(controller.live()).toEqual({ status: "ok" });
  });

  it("returns ready when database is up", async () => {
    const health = { ready: vi.fn().mockResolvedValue({ database: "up", storage: "not_configured" }) };
    const controller = new HealthController(health as unknown as HealthService);
    await expect(controller.ready()).resolves.toEqual({
      status: "ready",
      checks: { database: "up", storage: "not_configured" },
    });
  });

  it("throws 503 when database is down", async () => {
    const health = { ready: vi.fn().mockResolvedValue({ database: "down", storage: "not_configured" }) };
    const controller = new HealthController(health as unknown as HealthService);
    await expect(controller.ready()).rejects.toBeInstanceOf(HttpException);
    try {
      await controller.ready();
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(503);
    }
  });
});
