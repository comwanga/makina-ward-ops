import { Injectable } from "@nestjs/common";
import type { CapabilityCode } from "@ward-ops/contracts";
import { AuthContext } from "../auth/auth-context";
import { ScopeService } from "../authorization/scope.service";
import { PrismaService } from "../prisma/prisma.service";
import { todayNairobi } from "../attendance/attendance.service";

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async get(auth: AuthContext) {
    const asOf = new Date();
    const workDate = new Date(`${todayNairobi()}T00:00:00.000Z`);
    const wardIds = async (capability: CapabilityCode) =>
      (await this.scope.accessibleWards(auth, [capability])).map((ward) => ward.id);
    const [staffWards, attendanceWards, absenceWards, workWards] = await Promise.all([
      wardIds("STAFF_READ"),
      wardIds("ATTENDANCE_READ"),
      wardIds("ABSENCE_READ"),
      wardIds("WORK_READ"),
    ]);
    const reviewAbsences = auth.capabilities.includes("ABSENCE_REVIEW");
    const reviewWork = auth.capabilities.includes("WORK_REVIEW");
    const reportScopes = await this.scope.accessibleScopeIds({
      ...auth,
      requiredCapabilities: ["REPORTS_READ"],
    });

    const [activeStaff, attendance, openSessions, approvedAbsences, pendingAbsences, pendingWork, reports, absenceQueue, workQueue] =
      await this.prisma.client.$transaction([
        this.prisma.client.employee.count({
          where: {
            active: true,
            OR: [
              { wardId: { in: staffWards } },
              { assignments: { some: { wardId: { in: staffWards }, endedAt: null } } },
            ],
          },
        }),
        this.prisma.client.attendance.count({
          where: { wardId: { in: attendanceWards }, workDate, status: { in: ["PRESENT", "LATE"] } },
        }),
        this.prisma.client.attendanceSession.count({
          where: { wardId: { in: attendanceWards }, opensAt: { lte: asOf }, closesAt: { gt: asOf } },
        }),
        this.prisma.client.absenceRequest.count({
          where: {
            wardId: { in: absenceWards },
            status: "APPROVED",
            startDate: { lte: workDate },
            endDate: { gte: workDate },
          },
        }),
        this.prisma.client.absenceRequest.count({
          where: { wardId: { in: reviewAbsences ? absenceWards : [] }, status: "SUBMITTED" },
        }),
        this.prisma.client.workLog.count({
          where: { wardId: { in: reviewWork ? workWards : [] }, status: "SUBMITTED" },
        }),
        this.prisma.client.report.count({
          where: {
            status: "FINALIZED",
            OR: [
              { scopeType: "WARD", scopeId: { in: [...reportScopes.wardIds] } },
              { scopeType: "SUBCOUNTY", scopeId: { in: [...reportScopes.subcountyIds] } },
              { scopeType: "COUNTY", scopeId: { in: [...reportScopes.countyIds] } },
            ],
          },
        }),
        this.prisma.client.absenceRequest.findMany({
          where: { wardId: { in: reviewAbsences ? absenceWards : [] }, status: "SUBMITTED" },
          select: { id: true, kind: true, startDate: true, employee: { select: { fullName: true } } },
          orderBy: { createdAt: "asc" },
          take: 5,
        }),
        this.prisma.client.workLog.findMany({
          where: { wardId: { in: reviewWork ? workWards : [] }, status: "SUBMITTED" },
          select: { id: true, activity: true, location: true, workDate: true },
          orderBy: { createdAt: "asc" },
          take: 5,
        }),
      ]);

    return {
      asOf: asOf.toISOString(),
      workDate: todayNairobi(),
      metrics: {
        activeStaff,
        presentOrLateToday: attendance,
        openSessions,
        approvedAbsencesToday: approvedAbsences,
        pendingAbsences,
        pendingWorkLogs: pendingWork,
        finalizedReports: reports,
      },
      queue: [
        ...absenceQueue.map((item) => ({
          type: "ABSENCE",
          id: item.id,
          label: item.employee.fullName,
          detail: `${item.kind.replace(/_/g, " ").toLowerCase()} - ${item.startDate.toISOString().slice(0, 10)}`,
          href: "/absences",
        })),
        ...workQueue.map((item) => ({
          type: "WORK_LOG",
          id: item.id,
          label: item.activity,
          detail: `${item.location} - ${item.workDate.toISOString().slice(0, 10)}`,
          href: "/worklogs",
        })),
      ],
    };
  }
}
