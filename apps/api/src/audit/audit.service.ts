import { Injectable } from "@nestjs/common";
import { Prisma } from "@ward-ops/database";
import type { ScopeType } from "@ward-ops/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { ScopeService } from "../authorization/scope.service";
import type { AuthContext } from "../auth/auth-context";
import type { AuditQueryInput } from "@ward-ops/validation";

export interface AuditRecordInput {
  action: string;
  targetType: string;
  targetId?: string | null;
  scopeType?: ScopeType | null;
  scopeId?: string | null;
  actorUserId?: string | null;
  sourceIp?: string | null;
  requestId?: string | null;
  details?: string | null;
}

export interface AuditEventSummary {
  id: string;
  occurredAt: Date;
  actorUserId: string | null;
  actorDisplayName: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  scopeType: ScopeType | null;
  scopeId: string | null;
  details: string | null;
  sourceIp?: string | null;
}

export interface AuditListResult {
  items: AuditEventSummary[];
  page: number;
  pageSize: number;
  total: number;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async record(input: AuditRecordInput, transaction?: Prisma.TransactionClient): Promise<void> {
    const client = transaction ?? this.prisma.client;
    await client.auditEvent.create({ data: input });
  }

  /**
   * Scope-filtered audit history. Events are visible only when their scope is
   * within the caller's assignments (default-deny); global events that carry no
   * scope (e.g. sign-in attempts) are restricted to system admins.
   */
  async list(auth: AuthContext, query: AuditQueryInput): Promise<AuditListResult> {
    const { wardIds, subcountyIds, countyIds } = await this.scope.accessibleScopeIds(auth);
    const isSystemAdmin = auth.assignments.some((assignment) => assignment.role === "SYSTEM_ADMIN");

    const visibleScopes: Prisma.AuditEventWhereInput[] = [];
    if (wardIds.size) visibleScopes.push({ scopeType: "WARD", scopeId: { in: [...wardIds] } });
    if (subcountyIds.size) {
      visibleScopes.push({ scopeType: "SUBCOUNTY", scopeId: { in: [...subcountyIds] } });
    }
    if (countyIds.size) {
      visibleScopes.push({ scopeType: "COUNTY", scopeId: { in: [...countyIds] } });
    }
    if (isSystemAdmin) {
      visibleScopes.push({ OR: [{ scopeType: null }, { scopeId: null }] });
    }
    const where: Prisma.AuditEventWhereInput = {
      AND: [
        { OR: visibleScopes },
        ...(query.action ? [{ action: query.action }] : []),
      ],
    };
    const page = query.page;
    const pageSize = query.pageSize;
    if (!visibleScopes.length) return { items: [], page, pageSize, total: 0 };
    const [total, events] = await this.prisma.client.$transaction([
      this.prisma.client.auditEvent.count({ where }),
      this.prisma.client.auditEvent.findMany({
        where,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actor: { select: { displayName: true } } },
      }),
    ]);
    return {
      items: events.map((event) => ({
        id: event.id,
        occurredAt: event.occurredAt,
        actorUserId: event.actorUserId,
        actorDisplayName: event.actor?.displayName ?? null,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        scopeType: event.scopeType,
        scopeId: event.scopeId,
        details: event.details,
        ...(isSystemAdmin ? { sourceIp: event.sourceIp } : {}),
      })),
      page,
      pageSize,
      total,
    };
  }
}
