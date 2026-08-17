import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@ward-ops/database";
import type { AttendanceStatus, EvidenceStage } from "@ward-ops/contracts";
import type {
  ReportFinalizeInput,
  ReportPreviewQueryInput,
  ReportQueryInput,
} from "@ward-ops/validation";
import { AuthContext } from "../auth/auth-context";
import { ScopeService } from "../authorization/scope.service";
import { AttendanceService } from "../attendance/attendance.service";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  ReportSnapshot,
  ReportDay,
  ReportDayWard,
  ReportRosterRow,
  ReportWorkLog,
  deterministicNarrative,
  deterministicRecommendations,
  emptyTotals,
  enumerateDates,
  escapeCsvCell,
  fromDateString,
  isWeekend,
  reportTitle,
  samplePeriodPhotos,
  toDateOnly,
} from "./report-aggregation";

export interface RequestMeta {
  sourceIp?: string;
  requestId?: string;
}

interface RosterRow {
  employee: { id: string; employeeNumber: string; fullName: string };
  status: AttendanceStatus;
  detail: string;
  manualEditable: boolean;
}

type ReportWithRelations = Prisma.ReportGetPayload<{ include: { evidence: true } }>;

interface ResolvedScope {
  wardIds: string[];
  scopeName: string;
}

function collectReportEvidence(
  snapshot: ReportSnapshot,
): Prisma.ReportEvidenceCreateWithoutReportInput[] {
  const rows: Prisma.ReportEvidenceCreateWithoutReportInput[] = [];
  for (const workLog of snapshot.workLogs) {
    for (const photo of workLog.photos) {
      rows.push({
        evidenceId: photo.evidenceId,
        objectKey: photo.objectKey,
        sha256: photo.sha256,
        caption: photo.caption,
        stage: photo.stage,
      });
    }
  }
  return rows;
}

@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly attendance: AttendanceService,
    private readonly audit: AuditService,
  ) {}

  // -- Helpers ----------------------------------------------------------------

  private async resolveScope(
    auth: AuthContext,
    scopeType: "WARD" | "SUBCOUNTY" | "COUNTY",
    scopeId: string,
  ): Promise<ResolvedScope> {
    const accessible = await this.scope.accessibleWards(auth);
    if (scopeType === "WARD") {
      if (!(await this.scope.wardAccessible(auth, scopeId))) {
        throw new NotFoundException("Report scope not found");
      }
      const ward = await this.prisma.client.ward.findUnique({
        where: { id: scopeId },
        select: { name: true },
      });
      return { wardIds: [scopeId], scopeName: ward?.name ?? "Ward" };
    }
    if (scopeType === "SUBCOUNTY") {
      if (!(await this.scope.subcountyAccessible(auth, scopeId))) {
        throw new NotFoundException("Report scope not found");
      }
      const subcounty = await this.prisma.client.subcounty.findUnique({
        where: { id: scopeId },
        select: { name: true },
      });
      const wardIds = accessible
        .filter((ward) => ward.subcountyId === scopeId)
        .map((ward) => ward.id);
      return { wardIds, scopeName: subcounty?.name ?? "Subcounty" };
    }
    if (!(await this.scope.countyAccessible(auth, scopeId))) {
      throw new NotFoundException("Report scope not found");
    }
    const county = await this.prisma.client.county.findUnique({
      where: { id: scopeId },
      select: { name: true },
    });
    const subcounties = await this.prisma.client.subcounty.findMany({
      where: { countyId: scopeId },
      select: { id: true },
    });
    const subcountyIds = new Set(subcounties.map((subcounty) => subcounty.id));
    const wardIds = accessible
      .filter((ward) => subcountyIds.has(ward.subcountyId))
      .map((ward) => ward.id);
    return { wardIds, scopeName: county?.name ?? "County" };
  }

  private toSummary(report: ReportWithRelations): Record<string, unknown> {
    return {
      id: report.id,
      kind: report.kind,
      scopeType: report.scopeType,
      scopeId: report.scopeId,
      periodStart: toDateOnly(report.periodStart),
      periodEnd: toDateOnly(report.periodEnd),
      status: report.status,
      title: report.title,
      narrative: report.narrative,
      recommendations: report.recommendations,
      snapshot: report.snapshot as unknown as ReportSnapshot,
      version: report.version,
      finalizedBy: report.finalizedBy,
      finalizedAt: report.finalizedAt,
      createdBy: report.createdBy,
      createdAt: report.createdAt,
      evidence: report.evidence.map((evidence) => ({
        id: evidence.id,
        evidenceId: evidence.evidenceId,
        objectKey: evidence.objectKey,
        sha256: evidence.sha256,
        caption: evidence.caption,
        stage: evidence.stage,
      })),
    };
  }

  private async findOrThrow(id: string): Promise<ReportWithRelations> {
    const report = await this.prisma.client.report.findUnique({
      where: { id },
      include: { evidence: true },
    });
    if (!report) {
      throw new NotFoundException("Report not found");
    }
    return report;
  }

  // -- Aggregation ------------------------------------------------------------

  private async buildSnapshot(
    auth: AuthContext,
    input: ReportPreviewQueryInput,
  ): Promise<ReportSnapshot> {
    const { wardIds, scopeName } = await this.resolveScope(
      auth,
      input.scopeType,
      input.scopeId,
    );
    const start = fromDateString(input.startDate);
    const end = fromDateString(input.endDate);

    const wards = await this.prisma.client.ward.findMany({
      where: { id: { in: wardIds } },
      select: { id: true, name: true },
    });
    const wardNames = new Map(wards.map((ward) => [ward.id, ward.name]));

    const totals = emptyTotals();
    const days: ReportDay[] = [];
    const employeeNumbers = new Set<string>();

    for (const date of enumerateDates(start, end)) {
      const dayWards: ReportDayWard[] = [];
      for (const wardId of wardIds) {
        const session = await this.prisma.client.attendanceSession.findFirst({
          where: { wardId, workDate: date },
          orderBy: { createdAt: "desc" },
        });
        // §8: weekend days without an attendance session are excluded.
        if (!session && isWeekend(date)) continue;
        const roster = (await this.attendance.roster(auth, {
          wardId,
          workDate: toDateOnly(date),
        })) as unknown as RosterRow[];
        const rows: ReportRosterRow[] = [];
        for (const row of roster) {
          totals[row.status] = (totals[row.status] ?? 0) + 1;
          employeeNumbers.add(row.employee.employeeNumber);
          rows.push({
            employeeNumber: row.employee.employeeNumber,
            fullName: row.employee.fullName,
            role: null,
            status: row.status,
            detail: row.detail,
          });
        }
        dayWards.push({
          wardId,
          wardName: wardNames.get(wardId) ?? "",
          activity: session?.activity ?? "No attendance session",
          location: session?.location ?? wardNames.get(wardId) ?? "Ward",
          roster: rows,
        });
      }
      if (dayWards.length) days.push({ date: toDateOnly(date), wards: dayWards });
    }

    // Enrich roster rows with the employee designation (legacy CSV "Role" column).
    const designations = await this.prisma.client.employee.findMany({
      where: { employeeNumber: { in: [...employeeNumbers] } },
      select: { employeeNumber: true, designation: true },
    });
    const designationByNumber = new Map(
      designations.map((employee) => [employee.employeeNumber, employee.designation]),
    );
    for (const day of days) {
      for (const ward of day.wards) {
        for (const row of ward.roster) {
          row.role = designationByNumber.get(row.employeeNumber) ?? null;
        }
      }
    }

    const workLogs = await this.prisma.client.workLog.findMany({
      where: {
        wardId: { in: wardIds },
        status: "APPROVED",
        workDate: { gte: start, lte: end },
      },
      include: {
        detail: true,
        operations: true,
        evidence: { orderBy: { createdAt: "asc" } },
      },
      orderBy: [{ workDate: "asc" }, { createdAt: "asc" }],
    });

    const work: ReportWorkLog[] = workLogs.map((item) => ({
      id: item.id,
      wardId: item.wardId,
      wardName: wardNames.get(item.wardId) ?? "",
      date: toDateOnly(item.workDate),
      activity: item.activity,
      location: item.location,
      areasRoads: item.operations?.areasRoads ?? item.location,
      description: item.description,
      numberOfTrips: item.operations?.numberOfTrips ?? 0,
      wasteTransferInvolved: item.operations?.wasteTransferInvolved ?? false,
      truckId: item.operations?.truckId ?? null,
      backhoeId: item.operations?.backhoeId ?? null,
      cleanupDone: item.operations?.cleanupDone ?? false,
      cleanupStakeholders: item.operations?.cleanupStakeholders ?? null,
      climateTeamCount: item.operations?.climateTeamCount ?? 0,
      staffCount: item.staffCount,
      challenges: item.challenges,
      completionStatus: item.detail?.completionStatus ?? "COMPLETE",
      outstandingWork: item.detail?.outstandingWork ?? null,
      photos: samplePeriodPhotos(
        item.evidence.map((evidence) => ({
          evidenceId: evidence.id,
          objectKey: evidence.objectKey,
          sha256: evidence.sha256,
          caption: evidence.caption,
          stage: evidence.stage as EvidenceStage,
        })),
        input.kind,
      ),
    }));

    return {
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      scopeName,
      startDate: input.startDate,
      endDate: input.endDate,
      kind: input.kind,
      generatedAt: new Date().toISOString(),
      signedBy: null,
      signedTitle: null,
      totals,
      days,
      workLogs: work,
    };
  }

  // -- Reads ------------------------------------------------------------------

  async preview(
    auth: AuthContext,
    input: ReportPreviewQueryInput,
  ): Promise<Record<string, unknown>> {
    const snapshot = await this.buildSnapshot(auth, input);
    return {
      snapshot,
      narrative: deterministicNarrative(snapshot.totals, snapshot.workLogs),
      recommendations: deterministicRecommendations(snapshot.workLogs),
      title: reportTitle(input.kind, snapshot.scopeName),
    };
  }

  async list(auth: AuthContext, query: ReportQueryInput): Promise<Array<Record<string, unknown>>> {
    const reports = await this.prisma.client.report.findMany({
      include: { evidence: true },
      orderBy: { createdAt: "desc" },
    });
    const accessible: Array<Record<string, unknown>> = [];
    for (const report of reports) {
      if (await this.scope.scopeAccessible(auth, report.scopeType, report.scopeId)) {
        const summary = this.toSummary(report);
        if (query.scopeType && summary.scopeType !== query.scopeType) continue;
        if (query.scopeId && summary.scopeId !== query.scopeId) continue;
        if (query.kind && summary.kind !== query.kind) continue;
        accessible.push(summary);
      }
    }
    const startIndex = (query.page - 1) * query.pageSize;
    return accessible.slice(startIndex, startIndex + query.pageSize);
  }

  async get(auth: AuthContext, id: string): Promise<Record<string, unknown>> {
    const report = await this.findOrThrow(id);
    if (!(await this.scope.scopeAccessible(auth, report.scopeType, report.scopeId))) {
      throw new NotFoundException("Report not found");
    }
    return this.toSummary(report);
  }

  // -- Finalize ---------------------------------------------------------------

  async finalize(
    auth: AuthContext,
    input: ReportFinalizeInput,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const snapshot = await this.buildSnapshot(auth, input);
    const narrative =
      input.narrative?.trim() || deterministicNarrative(snapshot.totals, snapshot.workLogs);
    const recommendations =
      input.recommendations?.trim() || deterministicRecommendations(snapshot.workLogs);

    // §8: the immutable snapshot is signed with the finalizer's name and role
    // so a finalized report never depends on live user data.
    const finalizingAssignment = auth.assignments[0];
    const signedTitle =
      finalizingAssignment?.role === "SYSTEM_ADMIN"
        ? "Ward Environment Officer"
        : (finalizingAssignment?.role ?? "SYSTEM_ADMIN").replace(/_/g, " ").replace(/\w\S*/g, (w) => w.charAt(0) + w.slice(1).toLowerCase());
    snapshot.signedBy = auth.displayName;
    snapshot.signedTitle = signedTitle;

    const data: Prisma.ReportUncheckedCreateInput = {
      kind: input.kind,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      periodStart: fromDateString(input.startDate),
      periodEnd: fromDateString(input.endDate),
      status: "FINALIZED",
      title: reportTitle(input.kind, snapshot.scopeName),
      narrative,
      recommendations,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      version: 1,
      finalizedBy: auth.userId,
      finalizedAt: new Date(),
      createdBy: auth.userId,
      evidence: { create: collectReportEvidence(snapshot) },
    };

    const report = await this.prisma.client.report.create({
      data,
      include: { evidence: true },
    });
    await this.audit.record({
      action: "REPORT.FINALIZED",
      targetType: "Report",
      targetId: report.id,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      details: `${input.kind} ${input.startDate}..${input.endDate}`,
    });
    return this.toSummary(report);
  }

  // -- CSV export -------------------------------------------------------------

  async exportCsv(
    auth: AuthContext,
    id: string,
    meta: RequestMeta,
  ): Promise<{ buffer: Buffer; filename: string }> {
    // §8: read_only benchmark accounts cannot export operational data.
    if (auth.assignments.some((assignment) => assignment.role === "READ_ONLY")) {
      throw new ForbiddenException("Read-only benchmark accounts cannot export operational data");
    }
    const report = await this.findOrThrow(id);
    if (!(await this.scope.scopeAccessible(auth, report.scopeType, report.scopeId))) {
      throw new NotFoundException("Report not found");
    }
    const snapshot = report.snapshot as unknown as ReportSnapshot;

    const lines: string[] = [];
    lines.push(
      [
        "Work date",
        "Ward",
        "Employee ID",
        "Employee name",
        "Role",
        "Status",
        "Details",
        "Activity",
        "Location",
      ]
        .map(escapeCsvCell)
        .join(","),
    );
    for (const day of snapshot.days) {
      for (const ward of day.wards) {
        for (const row of ward.roster) {
          lines.push(
            [
              day.date,
              ward.wardName,
              row.employeeNumber,
              row.fullName,
              row.role,
              row.status,
              row.detail,
              ward.activity,
              ward.location,
            ]
              .map(escapeCsvCell)
              .join(","),
          );
        }
      }
    }

    await this.audit.record({
      action: "REPORT.CSV_EXPORTED",
      targetType: "Report",
      targetId: report.id,
      scopeType: report.scopeType,
      scopeId: report.scopeId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      details: `makina-${report.kind.toLowerCase()}-${toDateOnly(report.periodStart)}.csv`,
    });

    const filename = `makina-${report.kind.toLowerCase()}-${toDateOnly(report.periodStart)}.csv`;
    return { buffer: Buffer.from(`\ufeff${lines.join("\r\n")}\r\n`, "utf8"), filename };
  }
}