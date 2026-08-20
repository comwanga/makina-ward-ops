import { describe, expect, it } from "vitest";
import { BRANDING } from "@/lib/branding";

describe("branding", () => {
  it("points at the approved logo and background assets", () => {
    expect(BRANDING.logo).toBe("/branding/nairobi-city-county-logo.png");
    expect(BRANDING.background).toBe("/branding/nairobi-green-corridor.webp");
  });

  it("keeps the approved theme color", () => {
    expect(BRANDING.themeColor).toBe("#143d2b");
  });
});
