import type {
  AttendanceStatus,
  CompletionStatus,
  EvidenceStage,
  ReportKind,
  ScopeType,
} from "@ward-ops/contracts";
import { ATTENDANCE_STATUSES } from "@ward-ops/contracts";

// ---------------------------------------------------------------------------
// Pure, deterministic report aggregation helpers (§25, ADR-0007). No I/O:
// everything here is unit-testable without a database.
// ---------------------------------------------------------------------------

export const MAX_REPORT_SPAN_DAYS = 366;

export interface ReportPhotoRef {
  evidenceId: string;
  objectKey: string;
  sha256: string;
  caption: string | null;
  stage: EvidenceStage;
}

export interface ReportRosterRow {
  employeeNumber: string;
  fullName: string;
  role: string | null;
  status: AttendanceStatus;
  detail: string;
}

export interface ReportDayWard {
  wardId: string;
  wardName: string;
  activity: string;
  location: string;
  roster: ReportRosterRow[];
}

export interface ReportDay {
  date: string;
  wards: ReportDayWard[];
}

export interface ReportWorkLog {
  id: string;
  wardId: string;
  wardName: string;
  date: string;
  activity: string;
  location: string;
  areasRoads: string;
  description: string;
  numberOfTrips: number;
  wasteTransferInvolved: boolean;
  truckId: string | null;
  backhoeId: string | null;
  cleanupDone: boolean;
  cleanupStakeholders: string | null;
  climateTeamCount: number;
  staffCount: number;
  challenges: string | null;
  completionStatus: CompletionStatus;
  outstandingWork: string | null;
  photos: ReportPhotoRef[];
}

export interface ReportSnapshot {
  scopeType: ScopeType;
  scopeId: string;
  scopeName: string;
  startDate: string;
  endDate: string;
  kind: ReportKind;
  generatedAt: string;
  signedBy: string | null;
  signedTitle: string | null;
  totals: Record<AttendanceStatus, number>;
  days: ReportDay[];
  workLogs: ReportWorkLog[];
}

export function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function fromDateString(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Date-only, UTC-based iterator over [start, end] inclusive. */
export function enumerateDates(start: Date, end: Date): Date[] {
  const result: Date[] = [];
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  const final = new Date(end);
  final.setUTCHours(0, 0, 0, 0);
  while (cursor <= final) {
    result.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function reportTitle(kind: ReportKind, scopeName: string): string {
  const label =
    kind === "CUSTOM" ? "Custom" : `${kind.charAt(0)}${kind.slice(1).toLowerCase()}`;
  return `${label} Operations Report — ${scopeName}`;
}

/**
 * §8 / §23: daily reports keep every photo; weekly/monthly reports keep at most
 * four evenly spaced photos per stage (legacy sampling algorithm).
 */
export function samplePeriodPhotos(
  photos: ReportPhotoRef[],
  kind: ReportKind,
): ReportPhotoRef[] {
  if (kind !== "WEEKLY" && kind !== "MONTHLY") {
    return photos;
  }
  const byStage = new Map<EvidenceStage, ReportPhotoRef[]>();
  for (const photo of photos) {
    const list = byStage.get(photo.stage) ?? [];
    list.push(photo);
    byStage.set(photo.stage, list);
  }
  const selectedIds = new Set<string>();
  for (const stagePhotos of byStage.values()) {
    if (stagePhotos.length <= 4) {
      for (const photo of stagePhotos) selectedIds.add(photo.evidenceId);
      continue;
    }
    for (let index = 0; index < 4; index += 1) {
      const photo = stagePhotos[Math.round((index * (stagePhotos.length - 1)) / 3)];
      if (photo) selectedIds.add(photo.evidenceId);
    }
  }
  return photos.filter((photo) => selectedIds.has(photo.evidenceId));
}

export function emptyTotals(): Record<AttendanceStatus, number> {
  const totals = {} as Record<AttendanceStatus, number>;
  for (const status of ATTENDANCE_STATUSES) totals[status] = 0;
  return totals;
}

export function deterministicNarrative(
  totals: Record<AttendanceStatus, number>,
  workLogs: Pick<ReportWorkLog, "activity" | "numberOfTrips">[],
): string {
  const activities = [...new Set(workLogs.map((item) => item.activity))].sort();
  const outputParts = workLogs
    .filter((item) => (item.numberOfTrips ?? 0) > 0)
    .map((item) => `${item.numberOfTrips} trips (${item.activity})`);
  let text =
    `During the reporting period, ${workLogs.length} approved work activities were recorded. ` +
    `Attendance records contained ${totals.PRESENT ?? 0} present and ${totals.LATE ?? 0} late entries, ` +
    `with ${totals.ABSENT ?? 0} absence entries requiring or having received follow-up.`;
  if (activities.length) text += ` Activities covered ${activities.join(", ")}.`;
  if (outputParts.length) text += ` Recorded outputs included ${outputParts.join(", ")}.`;
  return text;
}

export function deterministicRecommendations(
  workLogs: Pick<ReportWorkLog, "activity" | "completionStatus">[],
): string {
  const incomplete = [
    ...new Set(
      workLogs
        .filter((item) => item.completionStatus === "INCOMPLETE")
        .map((item) => item.activity),
    ),
  ].sort();
  if (incomplete.length) {
    return `Prioritise follow-up and completion of: ${incomplete.join(
      ", ",
    )}. Continue monitoring attendance and documented field outputs.`;
  }
  return "Sustain the completed activities, continue routine monitoring, and address emerging operational challenges promptly.";
}

/**
 * §8 / §12: CSV formula-injection protection. Cells beginning with =, +, - or @
 * are prefixed with a single quote; cells containing commas, quotes or newlines
 * are double-quoted with doubled inner quotes.
 */
export function escapeCsvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}