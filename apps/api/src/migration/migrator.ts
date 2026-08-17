import type { Prisma, PrismaClient } from "@ward-ops/database";
import type {
  AbsenceKind,
  AttendanceStatus,
  CompletionStatus,
  DeliveryStatus,
  DocumentSensitivity,
  EvidenceStage,
  RoleCode,
  RosterStatus,
  WorkLogStatus,
} from "@ward-ops/contracts";
import type { ObjectStorage } from "../storage/object-storage.service";
import type {
  LegacyDatabaseRows,
  LegacyDocumentClassificationRow,
  LegacyEmployeeProfileRow,
  LegacyUserRow,
  LegacyWorkLogDetailRow,
  LegacyWorkLogOperationsRow,
} from "./legacy-db";
import {
  ABSENCE_KIND_MAP,
  ABSENCE_STATUS_MAP,
  ACCESS_REQUEST_STATUS_MAP,
  APPROVAL_STATUS_MAP,
  ATTENDANCE_STATUS_MAP,
  DEFAULT_ABSENCE_KIND,
  DEFAULT_ABSENCE_STATUS,
  DEFAULT_ACCESS_REQUEST_STATUS,
  DEFAULT_ATTENDANCE_STATUS,
  DEFAULT_COMPLETION_STATUS,
  DEFAULT_DELIVERY_STATUS,
  DEFAULT_DOCUMENT_CATEGORY,
  DEFAULT_DOCUMENT_SENSITIVITY,
  DEFAULT_REPORT_KIND,
  DEFAULT_ROLE_ASSIGNMENT,
  DEFAULT_ROSTER_STATUS,
  DEFAULT_WORK_LOG_STATUS,
  DELIVERY_STATUS_MAP,
  DOCUMENT_CATEGORY_MAP,
  DOCUMENT_SENSITIVITY_MAP,
  LEAVE_TYPE_MAP,
  REPORT_KIND_MAP,
  ROLE_ASSIGNMENT_MAP,
  ROSTER_STATUS_MAP,
  SCOPE_TO_CAPABILITY_MAP,
  WORK_LOG_STATUS_MAP,
  COMPLETION_STATUS_MAP,
  deriveRecommendations,
  mapEvidenceStage,
  toBool,
} from "./mapping";
import { migrateLegacyFile } from "./evidence";
import { emptyTableCount, summarizeCounts } from "./report";
import type { FileMigrationRecord, MigrationReport, TableCounts } from "./report";
import { reconcileEvidence } from "./reconcile";

export interface MigrationOptions {
  prisma: PrismaClient;
  storage: ObjectStorage;
  legacyDb: string;
  legacyDocRoot: string;
}

interface ScopeRefs {
  countyId: string;
  subcountyId: string;
  wardId: string;
}

function toDate(value: string): Date {
  return new Date(value);
}

function toDateTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.includes(" ") ? value.replace(" ", "T") : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Ordered migration of a legacy single-ward database into the new relational
 * model (§6). Reference data (roles/capabilities/hierarchy) must already be
 * seeded; the migrator resolves it by code and maps every operational record
 * to the Makina ward scope. Files (photos/documents) are migrated through the
 * broken-photo-safe flow and a full report is produced.
 */
export class LegacyMigrator {
  private readonly prisma: PrismaClient;
  private readonly storage: ObjectStorage;
  private readonly legacyDocRoot: string;
  private readonly rows: LegacyDatabaseRows;
  private readonly counts: TableCounts = {};
  private readonly files: FileMigrationRecord[] = [];
  private readonly notes: string[] = [];
  private scope!: ScopeRefs;
  private readonly userIds = new Map<number, string>();
  private readonly employeeIds = new Map<number, string>();
  private readonly sessionIds = new Map<number, string>();
  private readonly workLogIds = new Map<number, string>();
  private readonly evidenceIds = new Map<number, string>();
  private readonly absenceRequestIds = new Map<string, string>();
  private readonly documentIds = new Map<number, string>();
  private readonly reportIds = new Map<number, string>();

  constructor(options: MigrationOptions, rows: LegacyDatabaseRows) {
    this.prisma = options.prisma;
    this.storage = options.storage;
    this.legacyDocRoot = options.legacyDocRoot;
    this.rows = rows;
  }

  private table(name: string) {
    this.counts[name] ??= emptyTableCount();
    return this.counts[name];
  }

  private fail(name: string, reason: string): void {
    const count = this.table(name);
    count.failed += 1;
    count.failures.push(reason);
  }

  async run(legacyDb: string): Promise<MigrationReport> {
    const startedAt = new Date().toISOString();
    try {
      await this.resolveScope();
      await this.migrateUsers();
      await this.migrateAccessRequests();
      await this.migrateUserSessions();
      await this.migrateEmployees();
      await this.migrateAttendanceSessions();
      await this.migrateAttendance();
      await this.migrateAbsences();
      await this.migrateWorkLogs();
      await this.migrateEvidence();
      await this.migrateDocuments();
      await this.migrateReports();
      await this.migrateReminderDeliveries();
      await this.migrateAuditEvents();
    } catch (error) {
      this.notes.push(`Migration aborted: ${String(error)}`);
    }

    const reconciliation = await reconcileEvidence(this.prisma, this.storage);
    const success = Object.values(this.counts).every((c) => c.failed === 0);
    return {
      tool: "legacy-migrator",
      legacyDb,
      legacyDocRoot: this.legacyDocRoot,
      startedAt,
      finishedAt: new Date().toISOString(),
      counts: this.counts,
      files: this.files,
      reconciliation,
      notes: this.notes,
      success,
    };
  }

  summarize(): string[] {
    return summarizeCounts(this.counts);
  }

  // -- Reference scope -------------------------------------------------------

  private async resolveScope(): Promise<void> {
    const county = await this.prisma.county.findUnique({ where: { code: "NCC" } });
    const subcounty = await this.prisma.subcounty.findUnique({ where: { code: "KIBRA" } });
    const ward = await this.prisma.ward.findUnique({ where: { code: "MAKINA" } });
    if (!county || !subcounty || !ward) {
      throw new Error(
        "Reference hierarchy is missing (expected NCC -> KIBRA -> MAKINA). Run db:seed before migrating.",
      );
    }
    this.scope = { countyId: county.id, subcountyId: subcounty.id, wardId: ward.id };
  }

  // -- Users + assignments ---------------------------------------------------

  private async migrateUsers(): Promise<void> {
    const count = this.table("users");
    count.source = this.rows.users.length;

    for (const row of this.rows.users) {
      try {
        const user = await this.prisma.user.create({
          data: {
            email: row.email,
            displayName: row.display_name,
            passwordHash: row.password_hash,
            active: toBool(row.active),
            mustChangePassword: toBool(row.must_change_password),
            createdAt: toDateTime(row.created_at) ?? new Date(),
          },
        });
        const assignment = ROLE_ASSIGNMENT_MAP[row.role] ?? DEFAULT_ROLE_ASSIGNMENT;
        await this.prisma.assignment.create({
          data: {
            userId: user.id,
            roleId: await this.roleId(assignment.role),
            scopeType: assignment.scopeType,
            countyId: assignment.scopeType === "COUNTY" ? this.scope.countyId : null,
            subcountyId: assignment.scopeType === "SUBCOUNTY" ? this.scope.subcountyId : null,
            wardId: assignment.scopeType === "WARD" ? this.scope.wardId : null,
          },
        });

        // read_only accounts carry a CSV permission list (legacy SCOPES). Those
        // decompose into capabilities that enrich the READ_ONLY role.
        if (assignment.role === "READ_ONLY") {
          await this.enrichReadOnlyCapabilities(row);
        }

        this.userIds.set(row.id, user.id);
        count.migrated += 1;
      } catch (error) {
        this.fail("users", `user #${row.id} (${row.email}): ${String(error)}`);
      }
    }
  }

  private async roleId(code: RoleCode): Promise<string> {
    const role = await this.prisma.role.findUnique({ where: { code } });
    if (!role) throw new Error(`Role ${code} is not seeded`);
    return role.id;
  }

  private async enrichReadOnlyCapabilities(row: LegacyUserRow): Promise<void> {
    const capabilities = new Set<string>();
    if (row.permissions) {
      for (const part of row.permissions.split(",")) {
        const capability = SCOPE_TO_CAPABILITY_MAP[part.trim()];
        if (capability) capabilities.add(capability);
      }
    }
    if (capabilities.size === 0) return;
    const role = await this.prisma.role.findUnique({
      where: { code: "READ_ONLY" },
      include: { capabilities: { select: { capabilityId: true } } },
    });
    if (!role) return;
    for (const capability of capabilities) {
      const capabilityRow = await this.prisma.capability.findUnique({
        where: { code: capability as never },
      });
      if (!capabilityRow) continue;
      const exists = role.capabilities.some((c) => c.capabilityId === capabilityRow.id);
      if (exists) continue;
      await this.prisma.roleCapability.create({
        data: { roleId: role.id, capabilityId: capabilityRow.id },
      });
    }
  }

  private async migrateAccessRequests(): Promise<void> {
    const count = this.table("access_requests");
    count.source = this.rows.access_requests.length;
    for (const row of this.rows.access_requests) {
      try {
        const status = ACCESS_REQUEST_STATUS_MAP[row.status] ?? DEFAULT_ACCESS_REQUEST_STATUS;
        await this.prisma.accessRequest.create({
          data: {
            displayName: row.display_name,
            email: row.email,
            passwordHash: row.password_hash,
            reason: row.reason,
            status,
            requestedScope: null,
            targetUserId: row.target_user_id != null ? this.userIds.get(row.target_user_id) ?? null : null,
            reviewedBy: row.reviewed_by != null ? this.userIds.get(row.reviewed_by) ?? null : null,
            reviewNote: row.review_note,
            createdAt: toDateTime(row.created_at) ?? new Date(),
            reviewedAt: toDateTime(row.reviewed_at),
          },
        });
        count.migrated += 1;
      } catch (error) {
        this.fail("access_requests", `access request #${row.id}: ${String(error)}`);
      }
    }
  }

  private async migrateUserSessions(): Promise<void> {
    const count = this.table("user_sessions");
    count.source = this.rows.user_sessions.length;
    for (const row of this.rows.user_sessions) {
      try {
        const userId = this.userIds.get(row.user_id);
        if (!userId) {
          this.fail("user_sessions", `session #${row.id}: unknown user #${row.user_id}`);
          continue;
        }
        await this.prisma.userSession.create({
          data: {
            userId,
            tokenHash: row.token_hash,
            csrfToken: row.csrf_token,
            createdAt: toDateTime(row.created_at) ?? new Date(),
            expiresAt: toDateTime(row.expires_at) ?? new Date(),
            lastSeenAt: toDateTime(row.last_seen_at) ?? new Date(),
            revokedAt: toDateTime(row.revoked_at),
          },
        });
        count.migrated += 1;
      } catch (error) {
        this.fail("user_sessions", `session #${row.id}: ${String(error)}`);
      }
    }
  }

  // -- Employees -------------------------------------------------------------

  private async migrateEmployees(): Promise<void> {
    const count = this.table("employees");
    count.source = this.rows.employees.length;
    const profiles = new Map<number, LegacyEmployeeProfileRow>();
    for (const profile of this.rows.employee_profiles) profiles.set(profile.employee_id, profile);

    for (const row of this.rows.employees) {
      try {
        const employee = await this.prisma.employee.create({
          data: {
            employeeNumber: row.employee_number,
            fullName: row.full_name,
            phone: row.phone,
            email: row.email,
            designation: row.role || "Green Army Staff",
            active: toBool(row.active),
            wardId: this.scope.wardId,
            assignments: {
              create: { wardId: this.scope.wardId },
            },
          },
        });
        const profile = profiles.get(row.id);
        if (profile) {
          const rosterStatus: RosterStatus =
            ROSTER_STATUS_MAP[profile.roster_status] ?? DEFAULT_ROSTER_STATUS;
          await this.prisma.employeeProfile.create({
            data: {
              employeeId: employee.id,
              residence: profile.residence,
              rosterStatus,
              updatedAt: toDateTime(profile.updated_at) ?? new Date(),
            },
          });
        }
        this.employeeIds.set(row.id, employee.id);
        count.migrated += 1;
      } catch (error) {
        this.fail("employees", `employee #${row.id} (${row.employee_number}): ${String(error)}`);
      }
    }
  }

  // -- Attendance ------------------------------------------------------------

  private async migrateAttendanceSessions(): Promise<void> {
    const count = this.table("attendance_sessions");
    count.source = this.rows.attendance_sessions.length;
    for (const row of this.rows.attendance_sessions) {
      try {
        const session = await this.prisma.attendanceSession.create({
          data: {
            token: row.token,
            wardId: this.scope.wardId,
            workDate: toDate(row.work_date),
            activity: row.activity,
            location: row.location,
            opensAt: toDateTime(row.opens_at) ?? new Date(),
            closesAt: toDateTime(row.closes_at) ?? new Date(),
            createdAt: toDateTime(row.created_at) ?? new Date(),
            createdBy: this.primaryUser(),
          },
        });
        this.sessionIds.set(row.id, session.id);
        count.migrated += 1;
      } catch (error) {
        this.fail("attendance_sessions", `session #${row.id}: ${String(error)}`);
      }
    }
  }

  private primaryUser(): string {
    for (const legacyId of this.userIds.keys()) {
      const role = this.rows.users.find((u) => u.id === legacyId)?.role;
      if (role === "system_admin") return this.userIds.get(legacyId)!;
    }
    const first = this.userIds.values().next().value;
    if (!first) throw new Error("No user available to attribute legacy records to");
    return first;
  }

  private async migrateAttendance(): Promise<void> {
    const count = this.table("attendance");
    count.source = this.rows.attendance.length;
    for (const row of this.rows.attendance) {
      try {
        const employeeId = this.employeeIds.get(row.employee_id);
        const sessionId = this.sessionIds.get(row.session_id);
        if (!employeeId || !sessionId) {
          this.fail("attendance", `attendance #${row.id}: unresolved employee or session`);
          continue;
        }
        const status: AttendanceStatus =
          ATTENDANCE_STATUS_MAP[row.status] ?? DEFAULT_ATTENDANCE_STATUS;
        await this.prisma.attendance.create({
          data: {
            employeeId,
            sessionId,
            wardId: this.scope.wardId,
            workDate: toDate(row.work_date),
            checkedAt: toDateTime(row.checked_at) ?? new Date(),
            status,
            latitude: row.latitude,
            longitude: row.longitude,
          },
        });
        count.migrated += 1;
      } catch (error) {
        this.fail("attendance", `attendance #${row.id}: ${String(error)}`);
      }
    }
  }

  // -- Absences (unify legacy tables) ----------------------------------------

  private async migrateAbsences(): Promise<void> {
    await this.migrateAbsenceRequests();
    await this.migrateLegacyAbsences();
    await this.migratePlannedLeave();
  }

  private async migrateAbsenceRequests(): Promise<void> {
    const count = this.table("absences");
    for (const row of this.rows.absence_requests) {
      count.source += 1;
      await this.createAbsenceRequest("absence_requests", row.id, {
        employeeId: row.employee_id,
        kind: ABSENCE_KIND_MAP[row.kind] ?? DEFAULT_ABSENCE_KIND,
        startDate: toDate(row.start_date),
        endDate: toDate(row.end_date),
        returnDate: toDate(row.return_date),
        reason: row.reason,
        status: ABSENCE_STATUS_MAP[row.status] ?? DEFAULT_ABSENCE_STATUS,
        submittedBy: this.userIds.get(row.submitted_by),
        reviewedBy: row.reviewed_by != null ? this.userIds.get(row.reviewed_by) ?? null : null,
        reviewNote: row.review_note,
        createdAt: toDateTime(row.created_at) ?? new Date(),
        reviewedAt: toDateTime(row.reviewed_at),
      });
    }
  }

  private async migrateLegacyAbsences(): Promise<void> {
    for (const row of this.rows.absences) {
      this.table("absences").source += 1;
      const status = APPROVAL_STATUS_MAP[row.approval_status] ?? DEFAULT_ABSENCE_STATUS;
      const kind: AbsenceKind = ABSENCE_KIND_MAP[row.kind] ?? DEFAULT_ABSENCE_KIND;
      await this.createAbsenceRequest("absences", row.id, {
        employeeId: row.employee_id,
        kind,
        startDate: toDate(row.start_date),
        endDate: toDate(row.end_date),
        returnDate: toDate(row.return_date),
        reason: row.reason,
        status,
        submittedBy: this.primaryUser(),
        reviewedBy: null,
        reviewNote: null,
        createdAt: new Date(),
        reviewedAt: null,
      });
      if (row.attachment_name) {
        this.notes.push(
          `Legacy absences row #${row.id} referenced attachment "${row.attachment_name}"; no bytes were stored in the legacy DB, so the file was not migrated.`,
        );
      }
    }
  }

  private async migratePlannedLeave(): Promise<void> {
    for (const row of this.rows.planned_leave) {
      this.table("absences").source += 1;
      const kind = LEAVE_TYPE_MAP[row.leave_type] ?? DEFAULT_ABSENCE_KIND;
      await this.createAbsenceRequest("planned_leave", row.id, {
        employeeId: row.employee_id,
        kind,
        startDate: toDate(row.start_date),
        endDate: toDate(row.end_date),
        returnDate: toDate(row.return_date),
        reason: "",
        status: ABSENCE_STATUS_MAP[row.status] ?? DEFAULT_ABSENCE_STATUS,
        submittedBy: this.primaryUser(),
        reviewedBy: null,
        reviewNote: null,
        createdAt: new Date(),
        reviewedAt: null,
      });
    }
  }

  private async createAbsenceRequest(
    sourceTable: string,
    legacyId: number,
    input: {
      employeeId: number;
      kind: AbsenceKind;
      startDate: Date;
      endDate: Date;
      returnDate: Date;
      reason: string;
      status: (typeof ABSENCE_STATUS_MAP)[keyof typeof ABSENCE_STATUS_MAP];
      submittedBy: string | undefined;
      reviewedBy: string | null;
      reviewNote: string | null;
      createdAt: Date;
      reviewedAt: Date | null;
    },
  ): Promise<void> {
    const employeeId = this.employeeIds.get(input.employeeId);
    if (!employeeId) {
      this.fail("absences", `${sourceTable} #${legacyId}: unknown employee #${input.employeeId}`);
      return;
    }
    if (!input.submittedBy) {
      this.fail("absences", `${sourceTable} #${legacyId}: unresolved submitting user`);
      return;
    }
    try {
      const absence = await this.prisma.absenceRequest.create({
        data: {
          employeeId,
          wardId: this.scope.wardId,
          kind: input.kind,
          startDate: input.startDate,
          endDate: input.endDate,
          returnDate: input.returnDate,
          reason: input.reason,
          status: input.status,
          submittedBy: input.submittedBy,
          reviewedBy: input.reviewedBy,
          reviewNote: input.reviewNote,
          createdAt: input.createdAt,
          reviewedAt: input.reviewedAt,
        },
      });
      this.absenceRequestIds.set(`${sourceTable}:${legacyId}`, absence.id);
      this.table("absences").migrated += 1;
    } catch (error) {
      this.fail("absences", `${sourceTable} #${legacyId}: ${String(error)}`);
    }
  }

  // -- Work logs -------------------------------------------------------------

  private async migrateWorkLogs(): Promise<void> {
    const count = this.table("work_logs");
    count.source = this.rows.work_logs.length;
    const details = new Map<number, LegacyWorkLogDetailRow>();
    for (const row of this.rows.work_log_details) details.set(row.work_log_id, row);
    const operations = new Map<number, LegacyWorkLogOperationsRow>();
    for (const row of this.rows.work_log_operations) operations.set(row.work_log_id, row);

    for (const row of this.rows.work_logs) {
      try {
        const submittedBy = this.userIds.get(row.submitted_by);
        if (!submittedBy) {
          this.fail("work_logs", `work log #${row.id}: unknown submitter #${row.submitted_by}`);
          continue;
        }
        const status: WorkLogStatus =
          WORK_LOG_STATUS_MAP[row.status] ?? DEFAULT_WORK_LOG_STATUS;
        const workLog = await this.prisma.workLog.create({
          data: {
            wardId: this.scope.wardId,
            workDate: toDate(row.work_date),
            activity: row.activity,
            location: row.location,
            description: row.description,
            staffCount: row.staff_count ?? 0,
            challenges: row.challenges,
            status,
            submittedBy,
            reviewedBy: row.reviewed_by != null ? this.userIds.get(row.reviewed_by) ?? null : null,
            reviewNote: row.review_note,
            createdAt: toDateTime(row.created_at) ?? new Date(),
            reviewedAt: toDateTime(row.reviewed_at),
          },
        });

        const detail = details.get(row.id);
        if (detail) {
          const completionStatus: CompletionStatus =
            COMPLETION_STATUS_MAP[detail.completion_status] ?? DEFAULT_COMPLETION_STATUS;
          await this.prisma.workLogDetail.create({
            data: {
              workLogId: workLog.id,
              completionStatus,
              outstandingWork: detail.outstanding_work,
            },
          });
        }

        const operationsRow = operations.get(row.id);
        if (operationsRow) {
          await this.prisma.workLogOperations.create({
            data: {
              workLogId: workLog.id,
              areasRoads: operationsRow.areas_roads,
              numberOfTrips: operationsRow.number_of_trips ?? 0,
              wasteTransferInvolved: toBool(operationsRow.waste_transfer_involved),
              truckId: operationsRow.truck_id,
              backhoeId: operationsRow.backhoe_id,
              cleanupDone: toBool(operationsRow.cleanup_done),
              cleanupStakeholders: operationsRow.cleanup_stakeholders,
              climateTeamCount: operationsRow.climate_team_count ?? 0,
            },
          });
        }

        this.workLogIds.set(row.id, workLog.id);
        count.migrated += 1;
      } catch (error) {
        this.fail("work_logs", `work log #${row.id}: ${String(error)}`);
      }
    }
  }

  // -- Evidence (broken-photo-safe) ------------------------------------------

  private async migrateEvidence(): Promise<void> {
    const count = this.table("work_photos");
    count.source = this.rows.work_photos.length;
    const stages = new Map<number, string>();
    for (const row of this.rows.work_photo_stages) stages.set(row.photo_id, row.stage);

    for (const row of this.rows.work_photos) {
      const workLogId = this.workLogIds.get(row.work_log_id);
      if (!workLogId) {
        this.fail("work_photos", `photo #${row.id}: unknown work log #${row.work_log_id}`);
        continue;
      }
      const uploadedBy = this.userIds.get(row.uploaded_by);
      if (!uploadedBy) {
        this.fail("work_photos", `photo #${row.id}: unknown uploader #${row.uploaded_by}`);
        continue;
      }
      const stage: EvidenceStage = mapEvidenceStage(stages.get(row.id));

      const fileRecord = await migrateLegacyFile(this.storage, this.legacyDocRoot, {
        legacyTable: "work_photos",
        legacyId: row.id,
        storageKey: row.storage_key,
        originalName: row.original_filename,
        contentType: row.content_type,
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
      });
      this.files.push(fileRecord);

      if (fileRecord.outcome !== "MIGRATED" || !fileRecord.objectKey) {
        this.fail("work_photos", `photo #${row.id}: ${fileRecord.detail ?? fileRecord.outcome}`);
        continue;
      }
      try {
        const evidence = await this.prisma.evidence.create({
          data: {
            workLogId,
            objectKey: fileRecord.objectKey,
            stage,
            caption: row.caption,
            contentType: row.content_type,
            size: row.size_bytes,
            sha256: fileRecord.sha256 ?? row.sha256,
            uploadedBy,
            createdAt: toDateTime(row.uploaded_at) ?? new Date(),
          },
        });
        this.evidenceIds.set(row.id, evidence.id);
        count.migrated += 1;
      } catch (error) {
        this.fail("work_photos", `photo #${row.id}: ${String(error)}`);
      }
    }
  }

  // -- Documents -------------------------------------------------------------

  private async migrateDocuments(): Promise<void> {
    const count = this.table("documents");
    count.source = this.rows.documents.length;
    const classifications = new Map<number, LegacyDocumentClassificationRow>();
    for (const row of this.rows.document_classifications) classifications.set(row.document_id, row);

    for (const row of this.rows.documents) {
      const uploadedBy = this.userIds.get(row.uploaded_by);
      if (!uploadedBy) {
        this.fail("documents", `document #${row.id}: unknown uploader #${row.uploaded_by}`);
        continue;
      }
      const fileRecord = await migrateLegacyFile(this.storage, this.legacyDocRoot, {
        legacyTable: "documents",
        legacyId: row.id,
        storageKey: row.storage_key,
        originalName: row.original_filename,
        contentType: row.content_type,
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
      });
      this.files.push(fileRecord);

      if (fileRecord.outcome !== "MIGRATED" || !fileRecord.objectKey) {
        this.fail("documents", `document #${row.id}: ${fileRecord.detail ?? fileRecord.outcome}`);
        continue;
      }
      try {
        const absenceRequestId =
          row.absence_request_id != null
            ? this.absenceRequestIds.get(`absence_requests:${row.absence_request_id}`)
            : null;
        const sensitivity: DocumentSensitivity =
          DOCUMENT_SENSITIVITY_MAP[row.sensitivity] ?? DEFAULT_DOCUMENT_SENSITIVITY;
        const document = await this.prisma.document.create({
          data: {
            absenceRequestId,
            objectKey: fileRecord.objectKey,
            originalName: row.original_filename,
            contentType: row.content_type,
            size: row.size_bytes,
            sha256: fileRecord.sha256 ?? row.sha256,
            sensitivity,
            uploadedBy,
            createdAt: toDateTime(row.uploaded_at) ?? new Date(),
          },
        });
        const classification = classifications.get(row.id);
        if (classification) {
          const category =
            DOCUMENT_CATEGORY_MAP[classification.category] ?? DEFAULT_DOCUMENT_CATEGORY;
          await this.prisma.documentClassification.create({
            data: { documentId: document.id, category },
          });
        }
        this.documentIds.set(row.id, document.id);
        count.migrated += 1;
      } catch (error) {
        this.fail("documents", `document #${row.id}: ${String(error)}`);
      }
    }
  }

  // -- Reports + report evidence ---------------------------------------------

  private async migrateReports(): Promise<void> {
    const count = this.table("reports");
    count.source = this.rows.report_records.length;

    for (const row of this.rows.report_records) {
      try {
        const createdBy = this.userIds.get(row.created_by);
        if (!createdBy) {
          this.fail("reports", `report #${row.id}: unknown creator #${row.created_by}`);
          continue;
        }
        let snapshot: Record<string, unknown> | null = null;
        try {
          const parsed: unknown = JSON.parse(row.snapshot_json);
          if (parsed && typeof parsed === "object") snapshot = parsed as Record<string, unknown>;
        } catch {
          this.notes.push(`Report #${row.id} had an unparseable snapshot_json; stored as {}`);
        }

        const report = await this.prisma.report.create({
          data: {
            kind: REPORT_KIND_MAP[row.kind] ?? DEFAULT_REPORT_KIND,
            scopeType: "WARD",
            scopeId: this.scope.wardId,
            periodStart: toDate(row.start_date),
            periodEnd: toDate(row.end_date),
            status: "FINALIZED",
            title: row.title,
            narrative: row.narrative,
            recommendations: deriveRecommendations(snapshot),
            snapshot: (snapshot ?? {}) as unknown as Prisma.InputJsonValue,
            version: 1,
            finalizedBy: createdBy,
            finalizedAt: toDateTime(row.created_at) ?? new Date(),
            createdBy,
            createdAt: toDateTime(row.created_at) ?? new Date(),
          },
        });
        this.reportIds.set(row.id, report.id);

        await this.migrateReportEvidence(report.id, snapshot);
        count.migrated += 1;
      } catch (error) {
        this.fail("reports", `report #${row.id}: ${String(error)}`);
      }
    }
  }

  private async migrateReportEvidence(
    reportId: string,
    snapshot: Record<string, unknown> | null,
  ): Promise<void> {
    const workLogs = (snapshot?.work_logs as Array<Record<string, unknown>> | undefined) ?? [];
    for (const workItem of workLogs) {
      const photos = (workItem.photos as Array<Record<string, unknown>> | undefined) ?? [];
      for (const photo of photos) {
        const legacyPhotoId = Number(photo.id);
        const evidenceId = this.evidenceIds.get(legacyPhotoId);
        if (!evidenceId) continue;
        const evidence = await this.prisma.evidence.findUnique({
          where: { id: evidenceId },
          select: { objectKey: true, sha256: true },
        });
        if (!evidence) continue;
        await this.prisma.reportEvidence.create({
          data: {
            reportId,
            evidenceId,
            objectKey: evidence.objectKey,
            sha256: photo.sha256 ? String(photo.sha256) : evidence.sha256,
            caption: photo.caption != null ? String(photo.caption) : null,
            stage: mapEvidenceStage(
              photo.stage != null ? String(photo.stage) : null,
            ),
          },
        });
      }
    }
  }

  // -- Reminder deliveries + audit -------------------------------------------

  private async migrateReminderDeliveries(): Promise<void> {
    const count = this.table("reminder_deliveries");
    count.source = this.rows.reminder_deliveries.length;
    for (const row of this.rows.reminder_deliveries) {
      try {
        const absenceRequestId = this.absenceRequestIds.get(
          `absence_requests:${row.absence_request_id}`,
        );
        if (!absenceRequestId) {
          this.fail(
            "reminder_deliveries",
            `delivery #${row.id}: unknown absence request #${row.absence_request_id}`,
          );
          continue;
        }
        const status: DeliveryStatus =
          DELIVERY_STATUS_MAP[row.status] ?? DEFAULT_DELIVERY_STATUS;
        await this.prisma.reminderDelivery.create({
          data: {
            absenceRequestId,
            reminderDays: row.reminder_days,
            recipient: row.recipient,
            status,
            message: row.message,
            createdAt: toDateTime(row.created_at) ?? new Date(),
            sentAt: toDateTime(row.sent_at),
          },
        });
        count.migrated += 1;
      } catch (error) {
        this.fail("reminder_deliveries", `delivery #${row.id}: ${String(error)}`);
      }
    }
  }

  private async migrateAuditEvents(): Promise<void> {
    const count = this.table("audit_events");
    count.source = this.rows.audit_events.length;
    for (const row of this.rows.audit_events) {
      try {
        await this.prisma.auditEvent.create({
          data: {
            occurredAt: toDateTime(row.occurred_at) ?? new Date(),
            actorUserId: row.actor_user_id != null ? this.userIds.get(row.actor_user_id) ?? null : null,
            action: row.action,
            targetType: row.target_type,
            targetId: row.target_id,
            scopeType: null,
            scopeId: null,
            details: row.details,
            sourceIp: row.source_ip,
          },
        });
        count.migrated += 1;
      } catch (error) {
        this.fail("audit_events", `audit event #${row.id}: ${String(error)}`);
      }
    }
  }
}