import type {
  AbsenceKind,
  AbsenceStatus,
  AccessRequestStatus,
  AttendanceStatus,
  CapabilityCode,
  CompletionStatus,
  DeliveryStatus,
  DocumentCategory,
  DocumentSensitivity,
  EvidenceStage,
  ReportKind,
  RoleCode,
  RosterStatus,
  ScopeType,
  WorkLogStatus,
} from "@ward-ops/contracts";

/**
 * Pure mapping functions between legacy single-ward values and the new
 * domain enums. Each mapper is total: unknown values fall back to a
 * documented default rather than throwing, and the default is surfaced by
 * the migration report (never silently dropped or fabricated).
 */

export const ATTENDANCE_STATUS_MAP: Record<string, AttendanceStatus> = {
  present: "PRESENT",
  late: "LATE",
  absent: "ABSENT",
  off_duty: "OFF_DUTY",
  leave: "LEAVE",
  sick_off: "SICK_OFF",
  official_duty: "OFFICIAL_DUTY",
};
export const DEFAULT_ATTENDANCE_STATUS: AttendanceStatus = "PRESENT";

export const ABSENCE_KIND_MAP: Record<string, AbsenceKind> = {
  annual_leave: "ANNUAL_LEAVE",
  maternity_leave: "MATERNITY_LEAVE",
  paternity_leave: "PATERNITY_LEAVE",
  compassionate_leave: "COMPASSIONATE_LEAVE",
  sick_off: "SICK_OFF",
  official_duty: "OFFICIAL_DUTY",
  unpaid_leave: "UNPAID_LEAVE",
};
export const DEFAULT_ABSENCE_KIND: AbsenceKind = "ANNUAL_LEAVE";

/** Legacy planned_leave.leave_type values (human-readable) → enum. */
export const LEAVE_TYPE_MAP: Record<string, AbsenceKind> = {
  "Annual leave": "ANNUAL_LEAVE",
  "Maternity leave": "MATERNITY_LEAVE",
  "Paternity leave": "PATERNITY_LEAVE",
  "Compassionate leave": "COMPASSIONATE_LEAVE",
  "Sick off": "SICK_OFF",
  "Official duty": "OFFICIAL_DUTY",
  "Unpaid leave": "UNPAID_LEAVE",
};

export const ABSENCE_STATUS_MAP: Record<string, AbsenceStatus> = {
  planned: "PLANNED",
  submitted: "SUBMITTED",
  approved: "APPROVED",
  rejected: "REJECTED",
  cancelled: "CANCELLED",
};
export const DEFAULT_ABSENCE_STATUS: AbsenceStatus = "SUBMITTED";

/** Legacy absences.approval_status (pending/approved) → status. */
export const APPROVAL_STATUS_MAP: Record<string, AbsenceStatus> = {
  pending: "SUBMITTED",
  approved: "APPROVED",
};

export const WORK_LOG_STATUS_MAP: Record<string, WorkLogStatus> = {
  submitted: "SUBMITTED",
  approved: "APPROVED",
  rejected: "REJECTED",
};
export const DEFAULT_WORK_LOG_STATUS: WorkLogStatus = "SUBMITTED";

export const COMPLETION_STATUS_MAP: Record<string, CompletionStatus> = {
  complete: "COMPLETE",
  incomplete: "INCOMPLETE",
};
export const DEFAULT_COMPLETION_STATUS: CompletionStatus = "COMPLETE";

export const EVIDENCE_STAGE_MAP: Record<string, EvidenceStage> = {
  before: "BEFORE",
  during: "DURING",
  after: "AFTER",
  field: "DURING",
};
export const DEFAULT_EVIDENCE_STAGE: EvidenceStage = "DURING";

export const DOCUMENT_SENSITIVITY_MAP: Record<string, DocumentSensitivity> = {
  medical: "MEDICAL",
  general: "GENERAL",
};
export const DEFAULT_DOCUMENT_SENSITIVITY: DocumentSensitivity = "MEDICAL";

export const DOCUMENT_CATEGORY_MAP: Record<string, DocumentCategory> = {
  sick_sheet: "SICK_SHEET",
  medical_certificate: "MEDICAL_CERTIFICATE",
  leave_form: "LEAVE_FORM",
  leave_approval: "LEAVE_APPROVAL",
  return_to_work: "RETURN_TO_WORK",
  other: "OTHER",
};
export const DEFAULT_DOCUMENT_CATEGORY: DocumentCategory = "OTHER";

export const REPORT_KIND_MAP: Record<string, ReportKind> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  custom: "CUSTOM",
};
export const DEFAULT_REPORT_KIND: ReportKind = "CUSTOM";

export const DELIVERY_STATUS_MAP: Record<string, DeliveryStatus> = {
  queued: "PENDING",
  processing: "PENDING",
  sent: "SENT",
  failed: "FAILED",
};
export const DEFAULT_DELIVERY_STATUS: DeliveryStatus = "PENDING";

export const ROSTER_STATUS_MAP: Record<string, RosterStatus> = {
  on_duty: "ON_DUTY",
  annual_leave: "ANNUAL_LEAVE",
};
export const DEFAULT_ROSTER_STATUS: RosterStatus = "ON_DUTY";

export const ACCESS_REQUEST_STATUS_MAP: Record<string, AccessRequestStatus> = {
  pending: "PENDING",
  approved: "APPROVED",
  rejected: "REJECTED",
};
export const DEFAULT_ACCESS_REQUEST_STATUS: AccessRequestStatus = "PENDING";

export interface RoleAssignment {
  role: RoleCode;
  scopeType: ScopeType;
  scopeCode: string;
}

/**
 * Legacy users.role → initial Assignment (MIGRATION_PLAN §2). All legacy data
 * is single-ward (Makina); read_only accounts map to the Makina ward scope
 * (the only permission area that existed in the legacy single-ward system) so
 * migration never broadens a legacy account to the whole county.
 */
export const ROLE_ASSIGNMENT_MAP: Record<string, RoleAssignment> = {
  system_admin: { role: "SYSTEM_ADMIN", scopeType: "COUNTY", scopeCode: "NCC" },
  ward_officer: { role: "WARD_OFFICER", scopeType: "WARD", scopeCode: "MAKINA" },
  subcounty_reviewer: { role: "SUBCOUNTY_REVIEWER", scopeType: "SUBCOUNTY", scopeCode: "KIBRA" },
  hr_viewer: { role: "HR_VIEWER", scopeType: "SUBCOUNTY", scopeCode: "KIBRA" },
  read_only: { role: "READ_ONLY", scopeType: "WARD", scopeCode: "MAKINA" },
};
export const DEFAULT_ROLE_ASSIGNMENT: RoleAssignment = {
  role: "READ_ONLY",
  scopeType: "COUNTY",
  scopeCode: "NCC",
};

/**
 * Legacy read_only permissions CSV (a comma list of SCOPES keys) → capability
 * codes. Used to enrich the READ_ONLY role's grants during migration
 * (MIGRATION_PLAN §2) while preserving the role's baseline grants.
 */
export const SCOPE_TO_CAPABILITY_MAP: Record<string, CapabilityCode> = {
  attendance: "ATTENDANCE_READ",
  staff_register: "STAFF_READ",
  work_logs: "WORK_READ",
  absences: "ABSENCE_READ",
  reports: "REPORTS_READ",
  audit: "AUDIT_READ",
};

export function decomposePermissions(csv: string | null | undefined): CapabilityCode[] {
  if (!csv) return [];
  const seen = new Set<CapabilityCode>();
  for (const part of csv.split(",")) {
    const capability = SCOPE_TO_CAPABILITY_MAP[part.trim()];
    if (capability) seen.add(capability);
  }
  return [...seen];
}

/** Legacy work_photo_stages.stage or the "field" fallback → EvidenceStage. */
export function mapEvidenceStage(stage: string | null | undefined): EvidenceStage {
  if (stage && stage in EVIDENCE_STAGE_MAP) return EVIDENCE_STAGE_MAP[stage];
  return DEFAULT_EVIDENCE_STAGE;
}

/**
 * Legacy reports were always finalized and stored no recommendations column.
 * Recommendations are derived deterministically from the persisted snapshot,
 * matching the legacy `deterministic_recommendations` behaviour.
 */
export function deriveRecommendations(snapshot: Record<string, unknown> | null): string {
  const work = (snapshot?.work_logs as Array<Record<string, unknown>> | undefined) ?? [];
  const incomplete = [
    ...new Set(
      work
        .filter((item) => item.completion_status === "incomplete")
        .map((item) => String(item.activity))
        .filter(Boolean),
    ),
  ].sort();
  if (incomplete.length > 0) {
    return `Prioritise follow-up and completion of: ${incomplete.join(", ")}. Continue monitoring attendance and documented field outputs.`;
  }
  return "Sustain the completed activities, continue routine monitoring, and address emerging operational challenges promptly.";
}

export function toBool(value: number | null | undefined): boolean {
  return Boolean(value);
}