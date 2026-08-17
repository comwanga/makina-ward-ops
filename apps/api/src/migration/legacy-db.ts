import { DatabaseSync } from "node:sqlite";

/**
 * Typed row shapes for the legacy single-ward SQLAlchemy database (Phase 9
 * migration source). Values are the raw SQLite representations (TEXT dates as
 * ISO strings, booleans as 0/1); the mapping layer normalizes them.
 */

export interface LegacyEmployeeRow {
  id: number;
  employee_number: string;
  full_name: string;
  phone: string;
  email: string | null;
  role: string;
  active: number;
}

export interface LegacyEmployeeProfileRow {
  id: number;
  employee_id: number;
  residence: string | null;
  roster_status: string;
  updated_at: string;
}

export interface LegacyAttendanceSessionRow {
  id: number;
  token: string;
  work_date: string;
  activity: string;
  location: string;
  opens_at: string;
  closes_at: string;
  created_at: string;
}

export interface LegacyAttendanceRow {
  id: number;
  employee_id: number;
  session_id: number;
  work_date: string;
  checked_at: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
}

export interface LegacyAbsenceRow {
  id: number;
  employee_id: number;
  kind: string;
  start_date: string;
  end_date: string;
  return_date: string;
  reason: string;
  attachment_name: string | null;
  approval_status: string;
}

export interface LegacyPlannedLeaveRow {
  id: number;
  employee_id: number;
  leave_type: string;
  start_date: string;
  end_date: string;
  return_date: string;
  status: string;
  reminder_sent_at: string | null;
}

export interface LegacyAbsenceRequestRow {
  id: number;
  employee_id: number;
  kind: string;
  start_date: string;
  end_date: string;
  return_date: string;
  reason: string;
  status: string;
  submitted_by: number;
  reviewed_by: number | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface LegacyUserRow {
  id: number;
  email: string;
  display_name: string;
  password_hash: string;
  role: string;
  permissions: string | null;
  active: number;
  must_change_password: number;
  created_at: string;
}

export interface LegacyUserSessionRow {
  id: number;
  user_id: number;
  token_hash: string;
  csrf_token: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

export interface LegacyAccessRequestRow {
  id: number;
  display_name: string;
  email: string;
  password_hash: string;
  reason: string;
  status: string;
  created_at: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  review_note: string | null;
  requested_scope: string | null;
  target_user_id: number | null;
}

export interface LegacyAuditEventRow {
  id: number;
  occurred_at: string;
  actor_user_id: number | null;
  action: string;
  target_type: string;
  target_id: string | null;
  details: string | null;
  source_ip: string | null;
}

export interface LegacyDocumentRow {
  id: number;
  absence_request_id: number | null;
  storage_key: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  sensitivity: string;
  uploaded_by: number;
  uploaded_at: string;
}

export interface LegacyDocumentClassificationRow {
  id: number;
  document_id: number;
  category: string;
}

export interface LegacyWorkLogRow {
  id: number;
  work_date: string;
  activity: string;
  location: string;
  description: string;
  quantity: number | null;
  unit: string | null;
  staff_count: number;
  challenges: string | null;
  status: string;
  submitted_by: number;
  reviewed_by: number | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface LegacyWorkLogDetailRow {
  id: number;
  work_log_id: number;
  completion_status: string;
  outstanding_work: string | null;
}

export interface LegacyWorkLogOperationsRow {
  id: number;
  work_log_id: number;
  areas_roads: string;
  number_of_trips: number;
  waste_transfer_involved: number;
  truck_id: string | null;
  backhoe_id: string | null;
  cleanup_done: number;
  cleanup_stakeholders: string | null;
  climate_team_count: number;
}

export interface LegacyWorkPhotoRow {
  id: number;
  work_log_id: number;
  storage_key: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  caption: string | null;
  uploaded_by: number;
  uploaded_at: string;
}

export interface LegacyWorkPhotoStageRow {
  id: number;
  photo_id: number;
  stage: string;
}

export interface LegacyReportRecordRow {
  id: number;
  kind: string;
  start_date: string;
  end_date: string;
  status: string;
  title: string;
  narrative: string;
  snapshot_json: string;
  created_by: number;
  created_at: string;
}

export interface LegacyReminderDeliveryRow {
  id: number;
  absence_request_id: number;
  reminder_days: number;
  recipient: string;
  status: string;
  message: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface LegacyDatabaseRows {
  employees: LegacyEmployeeRow[];
  employee_profiles: LegacyEmployeeProfileRow[];
  attendance_sessions: LegacyAttendanceSessionRow[];
  attendance: LegacyAttendanceRow[];
  absences: LegacyAbsenceRow[];
  planned_leave: LegacyPlannedLeaveRow[];
  absence_requests: LegacyAbsenceRequestRow[];
  users: LegacyUserRow[];
  user_sessions: LegacyUserSessionRow[];
  access_requests: LegacyAccessRequestRow[];
  audit_events: LegacyAuditEventRow[];
  documents: LegacyDocumentRow[];
  document_classifications: LegacyDocumentClassificationRow[];
  work_logs: LegacyWorkLogRow[];
  work_log_details: LegacyWorkLogDetailRow[];
  work_log_operations: LegacyWorkLogOperationsRow[];
  work_photos: LegacyWorkPhotoRow[];
  work_photo_stages: LegacyWorkPhotoStageRow[];
  report_records: LegacyReportRecordRow[];
  reminder_deliveries: LegacyReminderDeliveryRow[];
}

const ALL_TABLES = [
  "employees",
  "employee_profiles",
  "attendance_sessions",
  "attendance",
  "absences",
  "planned_leave",
  "absence_requests",
  "users",
  "user_sessions",
  "access_requests",
  "audit_events",
  "documents",
  "document_classifications",
  "work_logs",
  "work_log_details",
  "work_log_operations",
  "work_photos",
  "work_photo_stages",
  "report_records",
  "reminder_deliveries",
] as const;

/**
 * Opens the legacy SQLite database read-only and reads every known table.
 * Tables that do not exist in the source are reported as empty so migration
 * tooling works against partially-populated legacy copies.
 */
export function readLegacyDatabase(dbPath: string): LegacyDatabaseRows {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const result = {} as LegacyDatabaseRows;
    for (const table of ALL_TABLES) {
      const exists = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table);
      const target = result as unknown as Record<string, unknown>;
      if (!exists) {
        target[table] = [];
        continue;
      }
      const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<
        string,
        string | number | null
      >[];
      target[table] = rows;
    }
    return result;
  } finally {
    db.close();
  }
}