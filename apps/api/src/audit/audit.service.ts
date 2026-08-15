import { Global, Injectable, Logger, Module } from "@nestjs/common";
import type { ScopeType } from "@ward-ops/contracts";
import { PrismaService } from "../prisma/prisma.service";

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

@Injectable()
export class AuditService {
  private readonly logger = new Logger("Audit");

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.prisma.client.auditEvent.create({ data: input });
    } catch (error) {
      this.logger.error(`Failed to persist audit event (${input.action})`, String(error));
    }
  }
}

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}