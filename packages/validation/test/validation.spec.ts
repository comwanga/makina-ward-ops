import { describe, expect, it } from "vitest";
import { employeeNumberSchema, kenyanPhoneSchema } from "../src/common";
import { createWorkLogSchema } from "../src/work-log";
import { createAbsenceSchema } from "../src/absence";

describe("employeeNumberSchema", () => {
  it("accepts an 11-digit year-prefixed ID", () => {
    expect(employeeNumberSchema.parse("20230464669")).toBe("20230464669");
  });

  it("rejects malformed IDs", () => {
    expect(() => employeeNumberSchema.parse("NCC-1042")).toThrow();
    expect(() => employeeNumberSchema.parse("12345")).toThrow();
  });
});

describe("kenyanPhoneSchema", () => {
  it("normalizes a 0-prefixed number", () => {
    expect(kenyanPhoneSchema.parse("0712345601")).toBe("0712345601");
  });

  it("accepts a +254 number", () => {
    expect(kenyanPhoneSchema.parse("+254712345601")).toBe("+254712345601");
  });

  it("rejects non-Kenyan numbers", () => {
    expect(() => kenyanPhoneSchema.parse("12345")).toThrow();
  });
});

describe("createWorkLogSchema", () => {
  const base = {
    wardId: "clh00000000000000000000000",
    workDate: "2026-08-15",
    activity: "Drainage clearing",
    location: "Makina Market",
    areasRoads: "Mashinani Road",
    description: "Cleared blocked drainage",
  };

  it("accepts a valid work log", () => {
    expect(createWorkLogSchema.parse(base).numberOfTrips).toBe(0);
  });

  it("rejects an invalid truck identifier", () => {
    expect(() =>
      createWorkLogSchema.parse({
        ...base,
        wasteTransferInvolved: true,
        numberOfTrips: 2,
        truckId: "161",
      }),
    ).toThrow();
  });

  it("requires a truck/backhoe when waste transfer is involved", () => {
    expect(() =>
      createWorkLogSchema.parse({
        ...base,
        wasteTransferInvolved: true,
        numberOfTrips: 2,
      }),
    ).toThrow();
  });

  it("requires outstanding work for incomplete work", () => {
    expect(() =>
      createWorkLogSchema.parse({ ...base, completionStatus: "INCOMPLETE" }),
    ).toThrow();
  });
});

describe("createAbsenceSchema", () => {
  const base = {
    employeeId: "clh00000000000000000000001",
    kind: "ANNUAL_LEAVE",
    startDate: "2026-08-15",
    endDate: "2026-08-16",
    returnDate: "2026-08-17",
  };

  it("accepts valid leave", () => {
    const parsed = createAbsenceSchema.parse(base);
    expect(parsed.planned).toBe(false);
    expect(parsed.reason).toBe("");
  });

  it("rejects return date before end date", () => {
    expect(() =>
      createAbsenceSchema.parse({ ...base, returnDate: "2026-08-15" }),
    ).toThrow();
  });

  it("requires a sufficient sick-off reason", () => {
    expect(() =>
      createAbsenceSchema.parse({ ...base, kind: "SICK_OFF", reason: "sick" }),
    ).toThrow();
  });
});
