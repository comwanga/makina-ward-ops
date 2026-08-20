import { describe, expect, it, vi } from "vitest";
import { AuditService } from "../src/audit/audit.service";

describe("AuditService", () => {
  it("propagates persistence failures instead of failing open", async () => {
    const failure = new Error("database unavailable");
    const prisma = {
      client: { auditEvent: { create: vi.fn().mockRejectedValue(failure) } },
    };
    const service = new AuditService(prisma as never, {} as never);

    await expect(
      service.record({ action: "TEST.FAILURE", targetType: "Test" }),
    ).rejects.toBe(failure);
  });
});
