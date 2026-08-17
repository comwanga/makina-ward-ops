import { describe, expect, it } from "vitest";
import {
  accessRequestDecisionSchema,
  accessRequestSchema,
  bootstrapSchema,
  changePasswordSchema,
  loginSchema,
} from "../src/auth";

describe("auth schemas", () => {
  it("accepts a valid login", () => {
    expect(
      loginSchema.parse({ email: "Officer@Makina.KE", password: "secret" }),
    ).toEqual({ email: "officer@makina.ke", password: "secret" });
  });

  it("rejects a login without a password", () => {
    expect(() => loginSchema.parse({ email: "o@m.ke", password: "" })).toThrow();
  });

  it("requires a strong new password for change-password", () => {
    expect(() =>
      changePasswordSchema.parse({
        currentPassword: "old",
        newPassword: "short",
      }),
    ).toThrow();
    expect(
      changePasswordSchema.parse({
        currentPassword: "old",
        newPassword: "a-very-strong-password",
      }).newPassword,
    ).toBe("a-very-strong-password");
  });

  it("validates bootstrap input and lowercases email", () => {
    const parsed = bootstrapSchema.parse({
      setupToken: "token-123",
      email: "ADMIN@Makina.local",
      password: "a-very-strong-password",
      displayName: "Admin",
    });
    expect(parsed.email).toBe("admin@makina.local");
    expect(parsed.setupToken).toBe("token-123");
  });

  it("requires a reason for an access request", () => {
    expect(() =>
      accessRequestSchema.parse({
        displayName: "Jane",
        email: "jane@m.ke",
        password: "a-very-strong-password",
        reason: "no",
      }),
    ).toThrow();
  });

  it("approval requires a roleCode", () => {
    expect(() =>
      accessRequestDecisionSchema.parse({ action: "approve" }),
    ).toThrow();
    expect(() =>
      accessRequestDecisionSchema.parse({
        action: "approve",
        roleCode: "READ_ONLY",
        scopeType: "WARD",
        scopeId: "cly0000000000000000000000",
      }),
    ).not.toThrow();
    expect(() =>
      accessRequestDecisionSchema.parse({
        action: "approve",
        roleCode: "READ_ONLY",
      }),
    ).not.toThrow();
  });

  it("rejection only needs a note", () => {
    expect(
      accessRequestDecisionSchema.parse({ action: "reject", note: "denied" }),
    ).toEqual({ action: "reject", note: "denied" });
  });
});