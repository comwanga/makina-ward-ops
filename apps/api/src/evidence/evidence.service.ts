import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@ward-ops/database";
import type { EvidenceStage } from "@ward-ops/contracts";
import type { EvidenceListInput } from "@ward-ops/validation";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthContext } from "../auth/auth-context";
import { ScopeService } from "../authorization/scope.service";
import { ObjectStorage, type StorageFileInput } from "../storage/object-storage.service";
import { EVIDENCE_MAX_PER_STAGE, processEvidenceImage } from "./image-pipeline";

export interface RequestMeta {
  sourceIp?: string;
  requestId?: string;
}

export interface EvidenceSummary {
  id: string;
  workLogId: string;
  stage: EvidenceStage;
  caption: string | null;
  contentType: string;
  size: number;
  sha256: string;
  uploadedBy: string;
  createdAt: Date;
}

type EvidenceWithRelations = Prisma.EvidenceGetPayload<{ include: { workLog: true } }>;

@Injectable()
export class EvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly storage: ObjectStorage,
  ) {}

  // -- Helpers ----------------------------------------------------------------

  private async workLogAccessibleOrThrow(auth: AuthContext, workLogId: string): Promise<void> {
    const workLog = await this.prisma.client.workLog.findUnique({
      where: { id: workLogId },
    });
    if (!workLog) {
      throw new NotFoundException("Work log not found");
    }
    if (!(await this.scope.wardAccessible(auth, workLog.wardId))) {
      throw new NotFoundException("Work log not found");
    }
  }

  private toSummary(evidence: EvidenceWithRelations): EvidenceSummary {
    return {
      id: evidence.id,
      workLogId: evidence.workLogId,
      stage: evidence.stage,
      caption: evidence.caption,
      contentType: evidence.contentType,
      size: evidence.size,
      sha256: evidence.sha256,
      uploadedBy: evidence.uploadedBy,
      createdAt: evidence.createdAt,
    };
  }

  // -- Upload ----------------------------------------------------------------

  async upload(
    auth: AuthContext,
    workLogId: string,
    file: StorageFileInput,
    stage: EvidenceStage,
    caption: string | null,
    meta: RequestMeta,
  ): Promise<EvidenceSummary> {
    const workLog = await this.prisma.client.workLog.findUnique({
      where: { id: workLogId },
    });
    if (!workLog) {
      throw new NotFoundException("Work log not found");
    }
    if (!(await this.scope.wardAccessible(auth, workLog.wardId))) {
      throw new NotFoundException("Work log not found");
    }
    if (workLog.status !== "SUBMITTED") {
      throw new ConflictException("Evidence cannot be changed after terminal review");
    }

    // §23 pipeline: signature validation, orientation normalization, resize,
    // compression happen before any bytes reach object storage.
    const processed = await processEvidenceImage(file);
    const stored = await this.storage.save({
      buffer: processed.buffer,
      originalName: file.originalName,
      contentType: processed.contentType,
    });

    try {
      const evidence = await this.prisma.client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-log:${workLogId}`}))`;
        const current = await tx.workLog.findUnique({ where: { id: workLogId } });
        if (!current || current.status !== "SUBMITTED") {
          throw new ConflictException("Evidence cannot be changed after terminal review");
        }
        const count = await tx.evidence.count({ where: { workLogId, stage } });
        if (count >= EVIDENCE_MAX_PER_STAGE) {
          throw new BadRequestException(
            `A work log can hold at most ${EVIDENCE_MAX_PER_STAGE} ${stage.toLowerCase()} photos`,
          );
        }
        const created = await tx.evidence.create({
          data: {
            workLogId,
            objectKey: stored.objectKey,
            stage,
            caption: caption?.trim() || null,
            contentType: processed.contentType,
            size: stored.size,
            sha256: stored.sha256,
            uploadedBy: auth.userId,
          },
          include: { workLog: true },
        });
        await this.audit.record({
          action: "WORK_LOG.EVIDENCE_UPLOADED",
          targetType: "Evidence",
          targetId: created.id,
          scopeType: "WARD",
          scopeId: workLog.wardId,
          actorUserId: auth.userId,
          sourceIp: meta.sourceIp,
          requestId: meta.requestId,
          details: `${stage} ${processed.contentType} ${stored.size} bytes`,
        }, tx);
        return created;
      });
      return this.toSummary(evidence);
    } catch (error) {
      // §24 storage consistency: never leave a permanent orphaned object when
      // the metadata write fails.
      await this.storage.delete(stored.objectKey);
      throw error;
    }
  }

  // -- Reads -----------------------------------------------------------------

  async list(auth: AuthContext, query: EvidenceListInput): Promise<EvidenceSummary[]> {
    const { workLogId } = query;
    const workLog = await this.prisma.client.workLog.findUnique({
      where: { id: workLogId },
    });
    if (!workLog) {
      throw new NotFoundException("Work log not found");
    }
    if (!(await this.scope.wardAccessible(auth, workLog.wardId))) {
      throw new NotFoundException("Work log not found");
    }

    const evidence = await this.prisma.client.evidence.findMany({
      where: { workLogId, stage: query.stage },
      include: { workLog: true },
      orderBy: { createdAt: "asc" },
      skip: query.page ? (query.page - 1) * (query.pageSize ?? 25) : undefined,
      take: query.page || query.pageSize ? query.pageSize ?? 25 : undefined,
    });
    return evidence.map((item) => this.toSummary(item));
  }

  async download(
    auth: AuthContext,
    evidenceId: string,
    meta: RequestMeta,
  ): Promise<{ buffer: Buffer; contentType: string; sha256: string }> {
    const evidence = await this.prisma.client.evidence.findUnique({
      where: { id: evidenceId },
      include: { workLog: true },
    });
    if (!evidence) {
      throw new NotFoundException("Evidence not found");
    }
    if (!(await this.scope.wardAccessible(auth, evidence.workLog.wardId))) {
      throw new NotFoundException("Evidence not found");
    }

    const buffer = await this.storage.read(evidence.objectKey);
    // §24: "DB metadata exists + object missing/corrupt" must be detectable.
    // Recompute the sha256 on read so a missing or corrupted object surfaces
    // as an error instead of silently serving broken evidence.
    const actual = createHash("sha256").update(buffer).digest("hex");
    if (actual !== evidence.sha256) {
      throw new NotFoundException("Evidence object is missing or corrupted");
    }

    await this.audit.record({
      action: "WORK_LOG.EVIDENCE_DOWNLOADED",
      targetType: "Evidence",
      targetId: evidence.id,
      scopeType: "WARD",
      scopeId: evidence.workLog.wardId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      details: evidence.stage,
    });
    return {
      buffer,
      contentType: evidence.contentType,
      sha256: evidence.sha256,
    };
  }
}
