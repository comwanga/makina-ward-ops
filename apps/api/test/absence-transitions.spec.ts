import { describe, expect, it } from "vitest";
import { nextAbsenceStatus } from "../src/absence/absence-transitions";

describe("absence transitions (§18)", () => {
  it("allows PLANNED to SUBMIT or CANCEL only", () => {
    expect(nextAbsenceStatus("PLANNED", "SUBMIT")).toBe("SUBMITTED");
    expect(nextAbsenceStatus("PLANNED", "CANCEL")).toBe("CANCELLED");
    expect(nextAbsenceStatus("PLANNED", "APPROVE")).toBeNull();
    expect(nextAbsenceStatus("PLANNED", "REJECT")).toBeNull();
  });

  it("allows SUBMITTED to APPROVE, REJECT or CANCEL only", () => {
    expect(nextAbsenceStatus("SUBMITTED", "APPROVE")).toBe("APPROVED");
    expect(nextAbsenceStatus("SUBMITTED", "REJECT")).toBe("REJECTED");
    expect(nextAbsenceStatus("SUBMITTED", "CANCEL")).toBe("CANCELLED");
    expect(nextAbsenceStatus("SUBMITTED", "SUBMIT")).toBeNull();
  });

  it("treats APPROVED, REJECTED and CANCELLED as terminal", () => {
    for (const status of ["APPROVED", "REJECTED", "CANCELLED"] as const) {
      for (const action of ["SUBMIT", "APPROVE", "REJECT", "CANCEL"] as const) {
        expect(nextAbsenceStatus(status, action)).toBeNull();
      }
    }
  });
});