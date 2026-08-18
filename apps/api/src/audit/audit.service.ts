import { Injectable, Logger } from "@nestjs/common";
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
  action: string;
  targetType: string;
  targetId: string | null;
  scopeType: ScopeType | null;
  scopeId: string | null;
  details: string | null;
  sourceIp: string | null;
}

export interface AuditListResult {
  items: AuditEventSummary[];
  page: number;
  pageSize: number;
  total: number;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger("Audit");

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.prisma.client.auditEvent.create({ data: input });
    } catch (error) {
      this.logger.error(`Failed to persist audit event (${input.action})`, String(error));
    }
  }

  /**
   * Scope-filtered audit history. Events are visible only when their scope is
   * within the caller's assignments (default-deny); global events that carry no
   * scope (e.g. sign-in attempts) are restricted to system admins.
   */
  async list(auth: AuthContext, query: AuditQueryInput): Promise<AuditListResult> {
    const { wardIds, subcountyIds, countyIds } = await this.scope.accessibleScopeIds(auth);
    const isSystemAdmin = auth.assignments.some((assignment) => assignment.role === "SYSTEM_ADMIN");

    const events = await this.prisma.client.auditEvent.findMany({
      where: query.action ? { action: query.action } : undefined,
      orderBy: { occurredAt: "desc" },
      take: 2000,
    });

    const visible = events.filter((event) => {
      if (!event.scopeType || !event.scopeId) return isSystemAdmin;
      if (event.scopeType === "WARD") return wardIds.has(event.scopeId);
      if (event.scopeType === "SUBCOUNTY") return subcountyIds.has(event.scopeId);
      if (event.scopeType === "COUNTY") return countyIds.has(event.scopeId);
      return false;
    });

    const page = query.page;
    const pageSize = query.pageSize;
    const start = (page - 1) * pageSize;
    return {
      items: visible.slice(start, start + pageSize).map((event) => ({
        id: event.id,
        occurredAt: event.occurredAt,
        actorUserId: event.actorUserId,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        scopeType: event.scopeType,
        scopeId: event.scopeId,
        details: event.details,
        sourceIp: event.sourceIp,
      })),
      page,
      pageSize,
      total: visible.length,
    };
  }
}
