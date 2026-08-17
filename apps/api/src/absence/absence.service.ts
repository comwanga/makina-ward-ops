import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@ward-ops/database";
import type { AbsenceStatus } from "@ward-ops/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthContext } from "../auth/auth-context";
import { ScopeService } from "../authorization/scope.service";
import type { AbsenceActionInput, AbsenceQueryInput, CreateAbsenceInput, DocumentCategory } from "@ward-ops/validation";
import { ObjectStorage, type StorageFileInput, type StoredObject } from "../storage/object-storage.service";
import { nextAbsenceStatus } from "./absence-transitions";

export interface RequestMeta {
  sourceIp?: string;
  requestId?: string;
}

export interface AbsenceSummary {
  id: string;
  employee: { id: string; employeeNumber: string; fullName: string };
  wardId: string;
  kind: string;
  startDate: Date;
  endDate: Date;
  returnDate: Date;
  reason: string;
  status: AbsenceStatus;
  version: number;
  submittedBy: string;
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
  documents: Array<{
    id: string;
    originalName: string;
    contentType: string;
    size: number;
    sensitivity: string;
    category: string;
  }>;
}

type AbsenceWithRelations = Prisma.AbsenceRequestGetPayload<{
  include: {
    employee: { select: { id: true; employeeNumber: true; fullName: true } };
    documents: { include: { classification: true } };
  };
}>;

const FILE_SIGNATURES: Array<{ magic: Buffer; contentType: string }> = [
  { magic: Buffer.from("%PDF"), contentType: "application/pdf" },
  { magic: Buffer.from([0xff, 0xd8, 0xff]), contentType: "image/jpeg" },
  { magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), contentType: "image/png" },
];

const MEDICAL_CATEGORIES: DocumentCategory[] = ["SICK_SHEET", "MEDICAL_CERTIFICATE", "RETURN_TO_WORK"];

const ACTION_AUDIT: Record<string, string> = {
  SUBMIT: "ABSENCE.SUBMITTED",
  APPROVE: "ABSENCE.APPROVED",
  REJECT: "ABSENCE.REJECTED",
  CANCEL: "ABSENCE.CANCELLED",
};

const ACTION_CAPABILITY: Record<string, "ABSENCE_MANAGE" | "ABSENCE_REVIEW"> = {
  SUBMIT: "ABSENCE_MANAGE",
  APPROVE: "ABSENCE_REVIEW",
  REJECT: "ABSENCE_REVIEW",
  CANCEL: "ABSENCE_MANAGE",
};

@Injectable()
export class AbsenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly storage: ObjectStorage,
  ) {}

  // -- Helpers ----------------------------------------------------------------

  private async wardAccessibleOrThrow(auth: AuthContext, wardId: string): Promise<void> {
    if (!(await this.scope.wardAccessible(auth, wardId))) {
      throw new ForbiddenException("Ward is outside your scope");
    }
  }

  private async accessibleWardIds(auth: AuthContext): Promise<string[]> {
    return (await this.scope.accessibleWards(auth)).map((ward) => ward.id);
  }

  private async findOrThrow(id: string): Promise<AbsenceWithRelations> {
    const absence = await this.prisma.client.absenceRequest.findUnique({
      where: { id },
      include: {
        employee: { select: { id: true, employeeNumber: true, fullName: true } },
        documents: { include: { classification: true } },
      },
    });
    if (!absence) {
      throw new NotFoundException("Absence request not found");
    }
    return absence;
  }

  private toSummary(absence: AbsenceWithRelations): AbsenceSummary {
    return {
      id: absence.id,
      employee: absence.employee,
      wardId: absence.wardId,
      kind: absence.kind,
      startDate: absence.startDate,
      endDate: absence.endDate,
      returnDate: absence.returnDate,
      reason: absence.reason,
      status: absence.status,
      version: absence.version,
      submittedBy: absence.submittedBy,
      reviewedBy: absence.reviewedBy,
      reviewNote: absence.reviewNote,
      createdAt: absence.createdAt,
      reviewedAt: absence.reviewedAt,
      documents: absence.documents.map((document) => ({
        id: document.id,
        originalName: document.originalName,
        contentType: document.contentType,
        size: document.size,
        sensitivity: document.sensitivity,
        category: document.classification?.category ?? "OTHER",
      })),
    };
  }

  private async assertNoOverlap(
    employeeId: string,
    startDate: Date,
    endDate: Date,
    excludeId?: string,
  ): Promise<void> {
    const overlapping = await this.prisma.client.absenceRequest.findFirst({
      where: {
        employeeId,
        id: excludeId ? { not: excludeId } : undefined,
        status: { in: ["SUBMITTED", "APPROVED"] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (overlapping) {
      throw new ConflictException("This employee already has an overlapping request");
    }
  }

  // -- Create ----------------------------------------------------------------

  async create(
    auth: AuthContext,
    input: CreateAbsenceInput,
    meta: RequestMeta,
  ): Promise<AbsenceSummary> {
    const employee = await this.prisma.client.employee.findUnique({
      where: { id: input.employeeId },
    });
    if (!employee || !employee.active) {
      throw new NotFoundException("Active employee not found");
    }
    await this.wardAccessibleOrThrow(auth, employee.wardId);

    const startDate = new Date(`${input.startDate}T00:00:00.000Z`);
    const endDate = new Date(`${input.endDate}T00:00:00.000Z`);
    const returnDate = new Date(`${input.returnDate}T00:00:00.000Z`);

    const status: AbsenceStatus = input.planned ? "PLANNED" : "SUBMITTED";
    if (status === "SUBMITTED") {
      await this.assertNoOverlap(employee.id, startDate, endDate);
    }

    const absence = await this.prisma.client.absenceRequest.create({
      data: {
        employeeId: employee.id,
        wardId: employee.wardId,
        kind: input.kind,
        startDate,
        endDate,
        returnDate,
        reason: input.reason,
        status,
        submittedBy: auth.userId,
      },
      include: {
        employee: { select: { id: true, employeeNumber: true, fullName: true } },
        documents: { include: { classification: true } },
      },
    });
    await this.audit.record({
      action: "ABSENCE.CREATED",
      targetType: "AbsenceRequest",
      targetId: absence.id,
      scopeType: "WARD",
      scopeId: absence.wardId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      details: `${input.kind} ${status}`,
    });
    return this.toSummary(absence);
  }

  // -- Reads -----------------------------------------------------------------

  async list(auth: AuthContext, query: AbsenceQueryInput): Promise<AbsenceSummary[]> {
    const wardIds = await this.accessibleWardIds(auth);
    const where: Prisma.AbsenceRequestWhereInput = { wardId: { in: wardIds } };
    if (query.wardId) {
      if (!wardIds.includes(query.wardId)) return [];
      where.wardId = query.wardId;
    }
    if (query.status) where.status = query.status;
    if (query.employeeId) where.employeeId = query.employeeId;

    const absences = await this.prisma.client.absenceRequest.findMany({
      where,
      include: {
        employee: { select: { id: true, employeeNumber: true, fullName: true } },
        documents: { include: { classification: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return absences.map((absence) => this.toSummary(absence));
  }

  async get(auth: AuthContext, id: string): Promise<AbsenceSummary> {
    const absence = await this.findOrThrow(id);
    if (!(await this.scope.wardAccessible(auth, absence.wardId))) {
      throw new NotFoundException("Absence request not found");
    }
    return this.toSummary(absence);
  }

  // -- Transitions -----------------------------------------------------------

  async action(
    auth: AuthContext,
    id: string,
    input: AbsenceActionInput,
    meta: RequestMeta,
  ): Promise<AbsenceSummary> {
    const absence = await this.findOrThrow(id);
    if (!(await this.scope.wardAccessible(auth, absence.wardId))) {
      throw new NotFoundException("Absence request not found");
    }

    const required = ACTION_CAPABILITY[input.action];
    if (!required || !auth.capabilities.includes(required)) {
      throw new ForbiddenException("You do not have permission for this action");
    }

    const next = nextAbsenceStatus(absence.status, input.action);
    if (!next) {
      throw new ConflictException(
        `An absence in ${absence.status} cannot be ${input.action.toLowerCase()}d`,
      );
    }

    if (input.action === "REJECT" && input.reviewNote.trim().length < 3) {
      throw new BadRequestException("A rejection note is required");
    }
    if (input.action === "SUBMIT") {
      await this.assertNoOverlap(absence.employeeId, absence.startDate, absence.endDate, id);
    }

    const reviewed = input.action === "APPROVE" || input.action === "REJECT";
    const updated = await this.prisma.client.absenceRequest.update({
      where: { id },
      data: {
        status: next,
        version: { increment: 1 },
        ...(reviewed
          ? {
              reviewedBy: auth.userId,
              reviewedAt: new Date(),
              reviewNote: input.reviewNote.trim() || null,
            }
          : {}),
      },
      include: {
        employee: { select: { id: true, employeeNumber: true, fullName: true } },
        documents: { include: { classification: true } },
      },
    });
    await this.audit.record({
      action: ACTION_AUDIT[input.action],
      targetType: "AbsenceRequest",
      targetId: id,
      scopeType: "WARD",
      scopeId: updated.wardId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      details: `${absence.status} -> ${next}`,
    });
    return this.toSummary(updated);
  }

  // -- Documents -------------------------------------------------------------

  async uploadDocument(
    auth: AuthContext,
    absenceId: string,
    file: StorageFileInput,
    category: DocumentCategory,
    meta: RequestMeta,
  ): Promise<{ id: string; originalName: string; contentType: string; size: number; category: string }> {
    const absence = await this.findOrThrow(absenceId);
    if (!(await this.scope.wardAccessible(auth, absence.wardId))) {
      throw new NotFoundException("Absence request not found");
    }
    if (absence.documents.length >= 5) {
      throw new BadRequestException("This request already has the maximum number of documents");
    }

    const contentType = detectContentType(file.buffer);
    if (!contentType) {
      throw new BadRequestException("Document must be a genuine PDF, JPG or PNG file");
    }

    const stored: StoredObject = await this.storage.save({
      buffer: file.buffer,
      originalName: file.originalName,
      contentType,
    });

    const sensitivity =
      absence.kind === "SICK_OFF" || MEDICAL_CATEGORIES.includes(category)
        ? "MEDICAL"
        : "GENERAL";

    try {
      const document = await this.prisma.client.document.create({
        data: {
          absenceRequestId: absence.id,
          objectKey: stored.objectKey,
          originalName: file.originalName.slice(0, 200),
          contentType,
          size: stored.size,
          sha256: stored.sha256,
          sensitivity,
          uploadedBy: auth.userId,
          classification: {
            create: { category },
          },
        },
        include: { classification: true },
      });
      await this.audit.record({
        action: "ABSENCE.DOCUMENT_UPLOADED",
        targetType: "Document",
        targetId: document.id,
        scopeType: "WARD",
        scopeId: absence.wardId,
        actorUserId: auth.userId,
        sourceIp: meta.sourceIp,
        requestId: meta.requestId,
        details: `${category} ${sensitivity}`,
      });
      return {
        id: document.id,
        originalName: document.originalName,
        contentType: document.contentType,
        size: document.size,
        category: document.classification?.category ?? "OTHER",
      };
    } catch (error) {
      // §24 storage consistency: never leave a permanent orphaned object when
      // the metadata write fails.
      await this.storage.delete(stored.objectKey);
      throw error;
    }
  }

  async downloadDocument(
    auth: AuthContext,
    documentId: string,
    meta: RequestMeta,
  ): Promise<{ buffer: Buffer; contentType: string; originalName: string }> {
    const document = await this.prisma.client.document.findUnique({
      where: { id: documentId },
      include: { absenceRequest: true },
    });
    if (!document || !document.absenceRequest) {
      throw new NotFoundException("Document not found");
    }
    const absence = document.absenceRequest;
    if (!(await this.scope.wardAccessible(auth, absence.wardId))) {
      throw new NotFoundException("Document not found");
    }
    if (document.sensitivity === "MEDICAL" && !auth.capabilities.includes("MEDICAL_READ")) {
      throw new ForbiddenException("Medical documents are restricted");
    }

    const buffer = await this.storage.read(document.objectKey);
    // Read-integrity, aligned with the evidence verification pattern (§24):
    // recompute the sha256 so a missing or corrupted stored object surfaces as
    // an error instead of silently serving broken content.
    const actual = createHash("sha256").update(buffer).digest("hex");
    if (actual !== document.sha256) {
      throw new NotFoundException("Document object is missing or corrupted");
    }
    await this.audit.record({
      action: "ABSENCE.DOCUMENT_DOWNLOADED",
      targetType: "Document",
      targetId: document.id,
      scopeType: "WARD",
      scopeId: absence.wardId,
      actorUserId: auth.userId,
      sourceIp: meta.sourceIp,
      requestId: meta.requestId,
      details: document.sensitivity,
    });
    return {
      buffer,
      contentType: document.contentType,
      originalName: document.originalName,
    };
  }
}

function detectContentType(buffer: Buffer): string | null {
  const match = FILE_SIGNATURES.find(({ magic }) =>
    buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic),
  );
  return match?.contentType ?? null;
}