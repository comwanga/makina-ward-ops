import { describe, expect, it } from "vitest";
import { nextWorkLogStatus } from "../src/work-log/work-log-transitions";

describe("work log transitions (§18)", () => {
  it("allows a draft to be submitted after evidence is attached", () => {
    expect(nextWorkLogStatus("DRAFT", "SUBMIT")).toBe("SUBMITTED");
  });

  it("allows SUBMITTED to be approved or rejected", () => {
    expect(nextWorkLogStatus("SUBMITTED", "APPROVE")).toBe("APPROVED");
    expect(nextWorkLogStatus("SUBMITTED", "REJECT")).toBe("REJECTED");
  });

  it("treats APPROVED and REJECTED as terminal", () => {
    for (const status of ["APPROVED", "REJECTED"] as const) {
      for (const action of ["SUBMIT", "APPROVE", "REJECT"] as const) {
        expect(nextWorkLogStatus(status, action)).toBeNull();
      }
    }
  });
});
