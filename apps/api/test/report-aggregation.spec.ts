import { describe, expect, it } from "vitest";
import {
  ReportPhotoRef,
  deterministicNarrative,
  deterministicRecommendations,
  emptyTotals,
  enumerateDates,
  escapeCsvCell,
  fromDateString,
  isWeekend,
  reportTitle,
  samplePeriodPhotos,
} from "../src/report/report-aggregation";

function photo(evidenceId: string, stage: "BEFORE" | "DURING" | "AFTER"): ReportPhotoRef {
  return {
    evidenceId,
    objectKey: `objects/${evidenceId}`,
    sha256: "a".repeat(64),
    caption: null,
    stage,
  };
}

describe("report aggregation (§25, §26, ADR-0007)", () => {
  describe("photo sampling (§8)", () => {
    it("keeps every photo for a daily report", () => {
      const photos = Array.from({ length: 6 }, (_, index) => photo(`e${index}`, "BEFORE"));
      expect(samplePeriodPhotos(photos, "DAILY")).toHaveLength(6);
      expect(samplePeriodPhotos(photos, "CUSTOM")).toHaveLength(6);
    });

    it("keeps all photos when a stage has at most four", () => {
      const photos = [
        photo("a", "BEFORE"),
        photo("b", "BEFORE"),
        photo("c", "DURING"),
      ];
      const sampled = samplePeriodPhotos(photos, "WEEKLY");
      expect(sampled.map((item) => item.evidenceId).sort()).toEqual(["a", "b", "c"]);
    });

    it("samples four evenly spaced photos per stage for weekly reports", () => {
      const photos = Array.from({ length: 5 }, (_, index) => photo(`e${index}`, "BEFORE"));
      const sampled = samplePeriodPhotos(photos, "WEEKLY");
      expect(sampled.map((item) => item.evidenceId).sort()).toEqual(["e0", "e1", "e3", "e4"]);
    });

    it("samples four evenly spaced photos when a stage has more than four", () => {
      const photos = Array.from({ length: 7 }, (_, index) => photo(`e${index}`, "BEFORE"));
      const sampled = samplePeriodPhotos(photos, "MONTHLY");
      expect(sampled).toHaveLength(4);
      // Legacy algorithm: round(index * (n-1) / 3) for n=7 -> 0, 2, 4, 6.
      expect(sampled.map((item) => item.evidenceId)).toEqual(["e0", "e2", "e4", "e6"]);
    });

    it("does not exceed four per stage when multiple stages are present", () => {
      const photos = [
        ...Array.from({ length: 6 }, (_, index) => photo(`b${index}`, "BEFORE")),
        ...Array.from({ length: 6 }, (_, index) => photo(`a${index}`, "AFTER")),
      ];
      const sampled = samplePeriodPhotos(photos, "WEEKLY");
      expect(sampled.filter((item) => item.stage === "BEFORE")).toHaveLength(4);
      expect(sampled.filter((item) => item.stage === "AFTER")).toHaveLength(4);
      expect(sampled).toHaveLength(8);
    });
  });

  describe("deterministic narrative", () => {
    it("reports attendance totals and approved work counts", () => {
      const totals = emptyTotals();
      totals.PRESENT = 3;
      totals.LATE = 1;
      totals.ABSENT = 2;
      const text = deterministicNarrative(totals, [
        { activity: "Drainage desilting", numberOfTrips: 4 },
        { activity: "Street sweeping", numberOfTrips: 0 },
      ]);
      expect(text).toContain("2 approved work activities were recorded");
      expect(text).toContain("3 present and 1 late entries");
      expect(text).toContain("2 absence entries");
      expect(text).toContain("Activities covered Drainage desilting, Street sweeping");
      expect(text).toContain("Recorded outputs included 4 trips (Drainage desilting)");
    });

    it("omits the activities and outputs sections when empty", () => {
      const text = deterministicNarrative(emptyTotals(), []);
      expect(text).toContain("0 approved work activities were recorded");
      expect(text).not.toContain("Activities covered");
      expect(text).not.toContain("Recorded outputs included");
    });
  });

  describe("deterministic recommendations", () => {
    it("prioritises incomplete activities", () => {
      const text = deterministicRecommendations([
        { activity: "Drainage desilting", completionStatus: "COMPLETE" },
        { activity: "Street sweeping", completionStatus: "INCOMPLETE" },
      ]);
      expect(text).toContain("Prioritise follow-up and completion of: Street sweeping");
    });

    it("returns the sustain message when everything is complete", () => {
      const text = deterministicRecommendations([
        { activity: "Drainage desilting", completionStatus: "COMPLETE" },
      ]);
      expect(text).toContain("Sustain the completed activities");
    });
  });

  describe("period helpers", () => {
    it("enumerates inclusive date-only ranges", () => {
      const dates = enumerateDates(
        fromDateString("2026-01-01"),
        fromDateString("2026-01-03"),
      );
      expect(dates).toHaveLength(3);
      expect(dates.map((date) => date.toISOString().slice(0, 10))).toEqual([
        "2026-01-01",
        "2026-01-02",
        "2026-01-03",
      ]);
    });

    it("flags Saturday and Sunday as weekend", () => {
      expect(isWeekend(fromDateString("2026-01-03"))).toBe(true); // Saturday
      expect(isWeekend(fromDateString("2026-01-04"))).toBe(true); // Sunday
      expect(isWeekend(fromDateString("2026-01-05"))).toBe(false); // Monday
    });
  });

  describe("report titles", () => {
    it("builds a title from kind and scope", () => {
      expect(reportTitle("DAILY", "Makina")).toBe("Daily Operations Report — Makina");
      expect(reportTitle("WEEKLY", "Kibra")).toBe("Weekly Operations Report — Kibra");
      expect(reportTitle("CUSTOM", "Makina")).toBe("Custom Operations Report — Makina");
    });
  });

  describe("CSV escaping (§8, §12)", () => {
    it("prefixes formula-injection cells with a single quote", () => {
      expect(escapeCsvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
      expect(escapeCsvCell("+1+2")).toBe("'+1+2");
      expect(escapeCsvCell("-1+2")).toBe("'-1+2");
      expect(escapeCsvCell("@cmd")).toBe("'@cmd");
    });

    it("leaves ordinary values untouched", () => {
      expect(escapeCsvCell("Makina")).toBe("Makina");
      expect(escapeCsvCell(42)).toBe("42");
      expect(escapeCsvCell(null)).toBe("");
    });

    it("double-quotes cells containing commas, quotes or newlines", () => {
      expect(escapeCsvCell("a, b")).toBe('"a, b"');
      expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
      expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
    });
  });
});