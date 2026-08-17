import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@ward-ops/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthContext } from "../auth/auth-context";
import { ScopeService } from "../authorization/scope.service";
import type {
  CreateEmployeeInput,
  CreateEmployeeAssignmentInput,
  UpdateEmployeeInput,
} from "@ward-ops/validation";

export interface RequestMeta {
  sourceIp?: string;
  requestId?: string;
}

export interface StaffSummary {
  id: string;
  employeeNumber: string;
  fullName: string;
  phone: string;
  email: string | null;
  designation: string;
  active: boolean;
  wardId: string;
  ward: { id: string; code: string; name: string };
  profile: { residence: string | null; rosterStatus: string } | null;
  assignments: Array<{
    id: string;
    wardId: string;
    assignedAt: Date;
    endedAt: Date | null;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

/** Normalizes a phone number to the legacy 0-prefixed storage form. */
export function normalizePhone(value: string): string {
  if (value.startsWith("+254")) return `0${value.slice(4)}`;
  return value;
}

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  private async wardAccessibleOrThrow(auth: AuthContext, wardId: string): Promise<void> {
    if (!(await this.scope.wardAccessible(auth, wardId))) {
      throw new ForbiddenException("Ward is outside your scope");
    }
  }

  private async findEmployeeOrThrow(id: string): Promise<Prisma.EmployeeGetPayload<{
    include: { profile: true; assignments: true; ward: true };
  }>> {
    const employee = await this.prisma.client.employee.findUnique({
      where: { id },
      include: { profile: true, assignments: true, ward: true },
    });
    if (!employee) {
      throw new NotFoundException("Employee not found");
    }
    return employee;
  }

  private toSummary(employee: Prisma.EmployeeGetPayload<{
    include: { profile: true; assignments: true; ward: true };
  }>): StaffSummary {
    return {
      id: employee.id,
      employeeNumber: employee.employeeNumber,
      fullName: employee.fullName,
      phone: employee.phone,
      email: employee.email,
      designation: employee.designation,
      active: employee.active,
      wardId: employee.wardId,
      ward: {
        id: employee.ward.id,
        code: employee.ward.code,
        name: employee.ward.name,
      },
      profile: employee.profile
        ? {
            residence: employee.profile.residence,
            rosterStatus: employee.profile.rosterStatus,
          }
        : null,
      assignments: employee.assignments
        .filter((assignment) => !assignment.endedAt)
        .map((assignment) => ({
          id: assignment.id,
          wardId: assignment.wardId,
          assignedAt: assignment.assignedAt,
          endedAt: assignment.endedAt,
        })),
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt,
    };
  }

  async list(auth: AuthContext): Promise<StaffSummary[]> {
    const wardIds = (await this.scope.accessibleWards(auth)).map((ward) => ward.id);
    const employees = await this.prisma.client.employee.findMany({
      where: { wardId: { in: wardIds } },
      include: { profile: true, assignments: true, ward: true },
      orderBy: { fullName: "asc" },
    });
    return employees.map((employee) => this.toSummary(employee));
  }

  async get(auth: AuthContext, id: string): Promise<StaffSummary> {
    const employee = await this.findEmployeeOrThrow(id);
    await this.wardAccessibleOrThrow(auth, employee.wardId);
    return this.toSummary(employee);
  }

  async create(
    auth: AuthContext,
    input: CreateEmployeeInput,
    meta: RequestMeta,
  ): Promise<StaffSummary> {
    await this.wardAccessibleOrThrow(auth, input.wardId);
    const phone = normalizePhone(input.phone);
    try {
      const employee = await this.prisma.client.employee.create({
        data: {
          employeeNumber: input.employeeNumber,
          fullName: input.fullName,
          phone,
          email: input.email ?? null,
          designation: input.designation,
          wardId: input.wardId,
          profile: {
            create: {
              residence: input.residence ?? null,
              rosterStatus: input.rosterStatus,
            },
          },
        },
        include: { profile: true, assignments: true, ward: true },
      });
      await this.audit.record({
        action: "EMPLOYEE.CREATED",
        targetType: "Employee",
        targetId: employee.id,
        scopeType: "WARD",
        scopeId: employee.wardId,
        actorUserId: auth.userId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
        details: input.employeeNumber,
      });
      return this.toSummary(employee);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("Employee number or phone already exists");
      }
      throw error;
    }
  }

  async update(
    auth: AuthContext,
    id: string,
    input: UpdateEmployeeInput,
    meta: RequestMeta,
  ): Promise<StaffSummary> {
    const existing = await this.findEmployeeOrThrow(id);
    await this.wardAccessibleOrThrow(auth, existing.wardId);

    const data: Prisma.EmployeeUpdateInput = {};
    if (input.fullName !== undefined) data.fullName = input.fullName;
    if (input.phone !== undefined) data.phone = normalizePhone(input.phone);
    if (input.email !== undefined) data.email = input.email;
    if (input.designation !== undefined) data.designation = input.designation;

    const profileData: Prisma.EmployeeProfileUpdateInput = {};
    if (input.residence !== undefined) profileData.residence = input.residence;
    if (input.rosterStatus !== undefined) profileData.rosterStatus = input.rosterStatus;

    try {
      const employee = await this.prisma.client.employee.update({
        where: { id },
        data: {
          ...data,
          profile: {
            upsert: {
              create: {
                residence: input.residence ?? null,
                rosterStatus: input.rosterStatus ?? existing.profile?.rosterStatus ?? "ON_DUTY",
              },
              update: profileData,
            },
          },
        },
        include: { profile: true, assignments: true, ward: true },
      });
      await this.audit.record({
        action: "EMPLOYEE.UPDATED",
        targetType: "Employee",
        targetId: id,
        scopeType: "WARD",
        scopeId: employee.wardId,
        actorUserId: auth.userId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
      });
      return this.toSummary(employee);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("Employee number or phone already exists");
      }
      throw error;
    }
  }

  async assign(
    auth: AuthContext,
    id: string,
    input: CreateEmployeeAssignmentInput,
    meta: RequestMeta,
  ): Promise<StaffSummary> {
    const employee = await this.findEmployeeOrThrow(id);
    await this.wardAccessibleOrThrow(auth, employee.wardId);
    await this.wardAccessibleOrThrow(auth, input.wardId);

    if (input.wardId === employee.wardId) {
      throw new ConflictException("Employee already belongs to that ward");
    }
    const active = employee.assignments.find(
      (assignment) => !assignment.endedAt && assignment.wardId === input.wardId,
    );
    if (active) {
      throw new ConflictException("Employee is already assigned to that ward");
    }

    await this.prisma.client.employeeAssignment.create({
      data: {
        employeeId: id,
        wardId: input.wardId,
      },
    });
    await this.audit.record({
      action: "EMPLOYEE.ASSIGNED",
      targetType: "Employee",
      targetId: id,
      scopeType: "WARD",
      scopeId: input.wardId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      details: input.wardId,
    });
    return this.get(auth, id);
  }

  async setActive(
    auth: AuthContext,
    id: string,
    active: boolean,
    meta: RequestMeta,
  ): Promise<StaffSummary> {
    const employee = await this.findEmployeeOrThrow(id);
    await this.wardAccessibleOrThrow(auth, employee.wardId);
    if (employee.active === active) {
      throw new ConflictException(`Employee is already ${active ? "active" : "deactivated"}`);
    }
    const updated = await this.prisma.client.employee.update({
      where: { id },
      data: { active },
      include: { profile: true, assignments: true, ward: true },
    });
    await this.audit.record({
      action: active ? "EMPLOYEE.REACTIVATED" : "EMPLOYEE.DEACTIVATED",
      targetType: "Employee",
      targetId: id,
      scopeType: "WARD",
      scopeId: updated.wardId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
    });
    return this.toSummary(updated);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}