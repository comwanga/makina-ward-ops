import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { RoleCode, ScopeType } from "@ward-ops/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthContext } from "../auth/auth-context";
import { ScopeService } from "../authorization/scope.service";
import { hashPassword } from "../common/crypto";

export interface RequestAccessInput {
  displayName: string;
  email: string;
  password: string;
  reason: string;
  requestedScope?: ScopeType;
  requestedScopeId?: string;
}

export interface AccessRequestDecision {
  action: "approve" | "reject";
  roleCode?: RoleCode;
  scopeType?: ScopeType;
  scopeId?: string;
  note?: string;
}

export interface RequestMeta {
  sourceIp?: string;
  requestId?: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  async requestAccess(input: RequestAccessInput, meta: RequestMeta): Promise<{ id: string }> {
    const existingUser = await this.prisma.client.user.findUnique({
      where: { email: input.email },
    });
    if (existingUser) {
      throw new ConflictException("An account already exists for this email");
    }
    const pending = await this.prisma.client.accessRequest.findFirst({
      where: { email: input.email, status: "PENDING" },
    });
    if (pending) {
      throw new ConflictException("An access request is already pending for this email");
    }

    const request = await this.prisma.client.accessRequest.create({
      data: {
        displayName: input.displayName,
        email: input.email,
        passwordHash: hashPassword(input.password),
        reason: input.reason,
        requestedScope: input.requestedScope ?? null,
        requestedScopeId: input.requestedScopeId ?? null,
      },
    });

    await this.audit.record({
      action: "ACCESS_REQUEST.CREATED",
      targetType: "AccessRequest",
      targetId: request.id,
      scopeType: input.requestedScope ?? null,
      scopeId: input.requestedScopeId ?? null,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      details: input.email,
    });
    return { id: request.id };
  }

  async listAccessRequests(auth: AuthContext): Promise<unknown[]> {
    const accessibleWards = new Set((await this.scope.accessibleWards(auth)).map((ward) => ward.id));
    const requests = await this.prisma.client.accessRequest.findMany({
      orderBy: { createdAt: "desc" },
    });

    const subcountyIds = requests
      .filter((request) => request.requestedScope === "SUBCOUNTY" && request.requestedScopeId)
      .map((request) => request.requestedScopeId as string);
    const subcounties = await this.prisma.client.subcounty.findMany({
      where: { id: { in: subcountyIds } },
      select: { id: true, countyId: true },
    });
    const subcountyToCounty = new Map(subcounties.map((subcounty) => [subcounty.id, subcounty.countyId]));

    return requests
      .filter((request) => {
        if (!request.requestedScope || !request.requestedScopeId) return true;
        const scopeId = request.requestedScopeId;
        if (request.requestedScope === "WARD") return accessibleWards.has(scopeId);
        if (request.requestedScope === "SUBCOUNTY") {
          return auth.assignments.some(
            (assignment) =>
              (assignment.scopeType === "SUBCOUNTY" &&
                assignment.subcountyId === scopeId) ||
              (assignment.scopeType === "COUNTY" &&
                assignment.countyId !== null &&
                subcountyToCounty.get(scopeId) === assignment.countyId),
          );
        }
        return auth.assignments.some(
          (assignment) =>
            assignment.scopeType === "COUNTY" && assignment.countyId === scopeId,
        );
      })
      .map((request) => ({
        id: request.id,
        displayName: request.displayName,
        email: request.email,
        reason: request.reason,
        status: request.status,
        requestedScope: request.requestedScope,
        requestedScopeId: request.requestedScopeId,
        createdAt: request.createdAt,
      }));
  }

  async reviewAccessRequest(
    auth: AuthContext,
    id: string,
    decision: AccessRequestDecision,
    meta: RequestMeta,
  ): Promise<{ id: string; status: string }> {
    const request = await this.prisma.client.accessRequest.findUnique({ where: { id } });
    if (!request) {
      throw new NotFoundException("Access request not found");
    }
    if (request.status !== "PENDING") {
      throw new ConflictException("Access request has already been reviewed");
    }

    if (decision.action === "reject") {
      const updated = await this.prisma.client.accessRequest.update({
        where: { id },
        data: {
          status: "REJECTED",
          reviewedBy: auth.userId,
          reviewNote: decision.note ?? null,
          reviewedAt: new Date(),
        },
      });
      await this.audit.record({
        action: "ACCESS_REQUEST.REJECTED",
        targetType: "AccessRequest",
        targetId: id,
        scopeType: request.requestedScope,
        scopeId: request.requestedScopeId,
        actorUserId: auth.userId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
      });
      return { id, status: updated.status };
    }

    const scopeType = decision.scopeType ?? request.requestedScope;
    const scopeId = decision.scopeId ?? request.requestedScopeId;
    if (!scopeType || !scopeId) {
      throw new BadRequestException(
        "Approval requires a scope for the new account",
      );
    }
    const accessible = await this.scope.scopeAccessible(auth, scopeType, scopeId);
    if (!accessible) {
      throw new ForbiddenException("Scope is outside your authority");
    }
    const roleCode = decision.roleCode ?? "READ_ONLY";
    const role = await this.prisma.client.role.findUnique({ where: { code: roleCode } });
    if (!role) {
      throw new BadRequestException("Unknown role");
    }

    const existingUser = await this.prisma.client.user.findUnique({
      where: { email: request.email },
    });
    if (existingUser) {
      throw new ConflictException("A user already exists for this email");
    }

    const user = await this.prisma.client.user.create({
      data: {
        email: request.email,
        displayName: request.displayName,
        passwordHash: request.passwordHash,
        active: true,
        mustChangePassword: true,
        assignments: {
          create: {
            roleId: role.id,
            scopeType,
            countyId: scopeType === "COUNTY" ? scopeId : null,
            subcountyId: scopeType === "SUBCOUNTY" ? scopeId : null,
            wardId: scopeType === "WARD" ? scopeId : null,
          },
        },
      },
    });

    await this.prisma.client.accessRequest.update({
      where: { id },
      data: {
        status: "APPROVED",
        targetUserId: user.id,
        reviewedBy: auth.userId,
        reviewNote: decision.note ?? null,
        reviewedAt: new Date(),
      },
    });

    await this.audit.record({
      action: "ACCESS_REQUEST.APPROVED",
      targetType: "AccessRequest",
      targetId: id,
      scopeType,
      scopeId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      details: `${request.email} -> ${roleCode}`,
    });
    return { id, status: "APPROVED" };
  }
}