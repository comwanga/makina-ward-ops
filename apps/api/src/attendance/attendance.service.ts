import { randomBytes } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { AttendanceStatus, Prisma } from "@ward-ops/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthContext } from "../auth/auth-context";
import { ScopeService } from "../authorization/scope.service";
import { CheckInThrottleService } from "./check-in-throttle.service";
import type {
  AttendanceQueryInput,
  CheckInInput,
  CreateAttendanceSessionInput,
  ManualAttendanceInput,
  RosterQueryInput,
} from "@ward-ops/validation";

export interface RequestMeta {
  sourceIp?: string;
  requestId?: string;
}

const NAIROBI_TZ = "Africa/Nairobi";

export function todayNairobi(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NAIROBI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function sessionToken(): string {
  return randomBytes(24).toString("base64url");
}

const LATE_THRESHOLD_MINUTES = 30;

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly throttle: CheckInThrottleService,
  ) {}

  private async wardAccessibleOrThrow(auth: AuthContext, wardId: string): Promise<void> {
    if (!(await this.scope.wardAccessible(auth, wardId))) {
      throw new ForbiddenException("Ward is outside your scope");
    }
  }

  private async accessibleWardIds(auth: AuthContext): Promise<string[]> {
    return (await this.scope.accessibleWards(auth)).map((ward) => ward.id);
  }

  private async sessionVisible(auth: AuthContext, session: {
    wardId: string;
  }): Promise<void> {
    if (!(await this.scope.wardAccessible(auth, session.wardId))) {
      throw new NotFoundException("Attendance session not found");
    }
  }

  // -- Sessions --------------------------------------------------------------

  async createSession(
    auth: AuthContext,
    input: CreateAttendanceSessionInput,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    await this.wardAccessibleOrThrow(auth, input.wardId);
    const workDate = input.workDate ?? todayNairobi();
    const workDateDate = toDateOnly(workDate);

    const active = await this.prisma.client.attendanceSession.findFirst({
      where: {
        wardId: input.wardId,
        workDate: workDateDate,
        closesAt: { gt: new Date() },
      },
    });
    if (active) {
      throw new ConflictException("An attendance session is already active for this ward on that date");
    }

    const opensAt = new Date();
    const closesAt = new Date(opensAt.getTime() + input.durationMinutes * 60 * 1000);
    const session = await this.prisma.client.attendanceSession.create({
      data: {
        token: sessionToken(),
        wardId: input.wardId,
        workDate: workDateDate,
        activity: input.activity,
        location: input.location,
        opensAt,
        closesAt,
        createdBy: auth.userId,
      },
    });

    await this.audit.record({
      action: "ATTENDANCE.SESSION_CREATED",
      targetType: "AttendanceSession",
      targetId: session.id,
      scopeType: "WARD",
      scopeId: session.wardId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      details: `Closes ${closesAt.toISOString()}`,
    });

    return {
      id: session.id,
      token: session.token,
      wardId: session.wardId,
      workDate,
      activity: session.activity,
      location: session.location,
      opensAt: session.opensAt,
      closesAt: session.closesAt,
    };
  }

  async listSessions(auth: AuthContext, query: AttendanceQueryInput): Promise<Array<Record<string, unknown>>> {
    const wardIds = await this.accessibleWardIds(auth);
    const where: Prisma.AttendanceSessionWhereInput = {
      wardId: { in: wardIds },
    };
    if (query.wardId) {
      if (!wardIds.includes(query.wardId)) {
        return [];
      }
      where.wardId = query.wardId;
    }
    if (query.workDate) {
      where.workDate = toDateOnly(query.workDate);
    }
    const sessions = await this.prisma.client.attendanceSession.findMany({
      where,
      include: { ward: true },
      orderBy: { createdAt: "desc" },
    });
    return sessions.map((session) => ({
      id: session.id,
      token: session.token,
      wardId: session.wardId,
      ward: { id: session.ward.id, code: session.ward.code, name: session.ward.name },
      workDate: session.workDate,
      activity: session.activity,
      location: session.location,
      opensAt: session.opensAt,
      closesAt: session.closesAt,
      createdAt: session.createdAt,
    }));
  }

  async getSession(auth: AuthContext, id: string): Promise<Record<string, unknown>> {
    const session = await this.prisma.client.attendanceSession.findUnique({
      where: { id },
      include: { ward: true },
    });
    if (!session) {
      throw new NotFoundException("Attendance session not found");
    }
    await this.sessionVisible(auth, session);
    return {
      id: session.id,
      token: session.token,
      wardId: session.wardId,
      ward: { id: session.ward.id, code: session.ward.code, name: session.ward.name },
      workDate: session.workDate,
      activity: session.activity,
      location: session.location,
      opensAt: session.opensAt,
      closesAt: session.closesAt,
      createdAt: session.createdAt,
    };
  }

  // -- QR check-in ------------------------------------------------------------

  async checkIn(input: CheckInInput, meta: RequestMeta): Promise<Record<string, unknown>> {
    const key = `${meta.sourceIp ?? "unknown"}:${input.sessionToken}`;
    this.throttle.check(key);

    const session = await this.prisma.client.attendanceSession.findUnique({
      where: { token: input.sessionToken },
    });
    const now = new Date();
    if (!session || !(session.opensAt <= now && now <= session.closesAt)) {
      this.throttle.recordFailure(key);
      throw new BadRequestException("This attendance session is not open. Contact your supervisor.");
    }

    const employee = await this.prisma.client.employee.findFirst({
      where: { employeeNumber: input.employeeNumber },
      include: { assignments: true },
    });
    const belongsToWard =
      employee !== null &&
      (employee.wardId === session.wardId ||
        employee.assignments.some((assignment) => !assignment.endedAt && assignment.wardId === session.wardId));

    if (!employee || !employee.active || !belongsToWard) {
      this.throttle.recordFailure(key);
      await this.audit.record({
        action: "ATTENDANCE.CHECKIN_FAILED",
        targetType: "AttendanceSession",
        targetId: session.id,
        scopeType: "WARD",
        scopeId: session.wardId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
        details: "Employee verification failed",
      });
      throw new BadRequestException("This Employee ID does not match an active employee in this ward's register.");
    }

    const status: AttendanceStatus =
      now.getTime() > session.opensAt.getTime() + LATE_THRESHOLD_MINUTES * 60 * 1000
        ? "LATE"
        : "PRESENT";

    try {
      const record = await this.prisma.client.attendance.create({
        data: {
          employeeId: employee.id,
          sessionId: session.id,
          wardId: session.wardId,
          workDate: session.workDate,
          checkedAt: now,
          status,
          verificationMethod: "QR",
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
        },
      });
      this.throttle.recordSuccess(key);
      await this.audit.record({
        action: "ATTENDANCE.CHECKED_IN",
        targetType: "Employee",
        targetId: employee.id,
        scopeType: "WARD",
        scopeId: session.wardId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
        details: `Status ${status}`,
      });
      return {
        ok: true,
        message: `Attendance confirmed for ${employee.fullName}.`,
        status,
        employee: { id: employee.id, fullName: employee.fullName },
        checkedAt: record.checkedAt,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Your attendance has already been recorded today.");
      }
      throw error;
    }
  }

  // -- Manual / supervised attendance ------------------------------------------

  async manual(
    auth: AuthContext,
    input: ManualAttendanceInput,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const employee = await this.prisma.client.employee.findUnique({
      where: { id: input.employeeId },
    });
    if (!employee || !employee.active) {
      throw new NotFoundException("Employee not found");
    }
    await this.wardAccessibleOrThrow(auth, employee.wardId);

    const workDateDate = toDateOnly(input.workDate);
    const session = await this.prisma.client.attendanceSession.findFirst({
      where: { wardId: employee.wardId, workDate: workDateDate },
      orderBy: { createdAt: "desc" },
    });
    if (!session) {
      throw new NotFoundException("No attendance session exists for this ward on that date");
    }

    const existing = await this.prisma.client.attendance.findUnique({
      where: { employeeId_workDate: { employeeId: employee.id, workDate: workDateDate } },
    });
    if (existing) {
      throw new ConflictException("Manual status is only allowed for staff who did not check in");
    }

    try {
      const record = await this.prisma.client.attendance.create({
        data: {
          employeeId: employee.id,
          sessionId: session.id,
          wardId: employee.wardId,
          workDate: workDateDate,
          checkedAt: new Date(),
          status: input.status,
          verificationMethod: "MANUAL",
        },
      });
      await this.audit.record({
        action: "ATTENDANCE.MANUAL",
        targetType: "Employee",
        targetId: employee.id,
        scopeType: "WARD",
        scopeId: employee.wardId,
        actorUserId: auth.userId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
        details: `${input.status}: ${input.reason}`,
      });
      return {
        id: record.id,
        employeeId: employee.id,
        status: record.status,
        workDate: input.workDate,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Attendance already exists for this employee on that date");
      }
      throw error;
    }
  }

  // -- Reads ------------------------------------------------------------------

  async listAttendance(auth: AuthContext, query: AttendanceQueryInput): Promise<Array<Record<string, unknown>>> {
    const wardIds = await this.accessibleWardIds(auth);
    const where: Prisma.AttendanceWhereInput = { wardId: { in: wardIds } };
    if (query.wardId) {
      if (!wardIds.includes(query.wardId)) {
        return [];
      }
      where.wardId = query.wardId;
    }
    if (query.sessionId) where.sessionId = query.sessionId;
    if (query.workDate) where.workDate = toDateOnly(query.workDate);

    const records = await this.prisma.client.attendance.findMany({
      where,
      include: {
        employee: { select: { id: true, employeeNumber: true, fullName: true } },
        session: { select: { id: true, activity: true, location: true } },
      },
      orderBy: [{ workDate: "desc" }, { checkedAt: "desc" }],
    });
    return records.map((record) => ({
      id: record.id,
      employeeId: record.employeeId,
      employeeNumber: record.employee.employeeNumber,
      fullName: record.employee.fullName,
      wardId: record.wardId,
      sessionId: record.sessionId,
      sessionActivity: record.session.activity,
      workDate: record.workDate,
      checkedAt: record.checkedAt,
      status: record.status,
      verificationMethod: record.verificationMethod,
    }));
  }

  async roster(auth: AuthContext, query: RosterQueryInput): Promise<Array<Record<string, unknown>>> {
    await this.wardAccessibleOrThrow(auth, query.wardId);
    const workDate = query.workDate ?? todayNairobi();
    const workDateDate = toDateOnly(workDate);

    const employees = await this.prisma.client.employee.findMany({
      where: {
        active: true,
        OR: [
          { wardId: query.wardId },
          { assignments: { some: { wardId: query.wardId, endedAt: null } } },
        ],
      },
      include: { profile: true },
      orderBy: { fullName: "asc" },
    });

    const records = await this.prisma.client.attendance.findMany({
      where: { wardId: query.wardId, workDate: workDateDate },
    });
    const recordByEmployee = new Map(records.map((record) => [record.employeeId, record]));

    return employees.map((employee) => {
      const record = recordByEmployee.get(employee.id);
      let status: AttendanceStatus;
      let detail: string;
      let manualEditable = false;
      if (record && (record.status === "PRESENT" || record.status === "LATE")) {
        status = record.status;
        detail = record.checkedAt.toISOString().slice(11, 16);
      } else if (record) {
        status = record.status;
        detail = "Manual status";
      } else if (employee.profile?.rosterStatus === "ANNUAL_LEAVE") {
        status = "LEAVE";
        detail = "Annual leave (staff roster)";
      } else {
        status = "ABSENT";
        detail = "No check-in";
        manualEditable = true;
      }
      return {
        employee: {
          id: employee.id,
          employeeNumber: employee.employeeNumber,
          fullName: employee.fullName,
        },
        status,
        detail,
        manualEditable,
      };
    });
  }
}