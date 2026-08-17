import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/config";

describe("loadConfig", () => {
  it("loads a valid development configuration with defaults", () => {
    const config = loadConfig({
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      APP_ENV: "development",
    });
    expect(config.port).toBe(4000);
    expect(config.sessionHours).toBe(12);
    expect(config.storage.configured).toBe(false);
    expect(config.smtp.configured).toBe(false);
    expect(config.ai.enabled).toBe(false);
  });

  it("fails when DATABASE_URL is missing", () => {
    expect(() => loadConfig({ APP_ENV: "development" })).toThrow();
  });

  it("requires SECURE_COOKIES in production", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgresql://u:p@localhost:5432/db",
        APP_ENV: "production",
      }),
    ).toThrow();
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgresql://u:p@localhost:5432/db",
        APP_ENV: "production",
        SECURE_COOKIES: "true",
      }),
    ).not.toThrow();
  });
});
