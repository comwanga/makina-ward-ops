import { BadRequestException, Controller, Get, Param, Post, Query, Req, StreamableFile } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { evidenceListSchema, evidenceMetaSchema } from "@ward-ops/validation";
import { RequireCapability } from "../authorization/capability.decorator";
import { CurrentUser, AuthContext } from "../auth/auth-context";
import { EvidenceService, RequestMeta } from "./evidence.service";

function meta(request: FastifyRequest): RequestMeta {
  return {
    sourceIp: request.ip,
    requestId: request.headers["x-request-id"] as string | undefined,
  };
}

@Controller("evidence")
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @RequireCapability("WORK_CREATE")
  @Post()
  async upload(@CurrentUser() auth: AuthContext | undefined, @Req() request: FastifyRequest) {
    if (!request.isMultipart()) {
      throw new BadRequestException("Expected a multipart photo upload");
    }
    const file = await request.file();
    if (!file) {
      throw new BadRequestException("No photo supplied");
    }
    const stageField = file.fields?.["stage"];
    const rawStage = Array.isArray(stageField) ? stageField[0] : stageField;
    const rawStageValue =
      rawStage && typeof rawStage === "object" && "value" in rawStage
        ? String((rawStage as { value: unknown }).value)
        : String(rawStage ?? "");
    const workLogField = file.fields?.["workLogId"];
    const rawWorkLog = Array.isArray(workLogField) ? workLogField[0] : workLogField;
    const workLogId =
      rawWorkLog && typeof rawWorkLog === "object" && "value" in rawWorkLog
        ? String((rawWorkLog as { value: unknown }).value)
        : String(rawWorkLog ?? "");
    const captionField = file.fields?.["caption"];
    const rawCaption = Array.isArray(captionField) ? captionField[0] : captionField;
    const caption =
      rawCaption && typeof rawCaption === "object" && "value" in rawCaption
        ? String((rawCaption as { value: unknown }).value)
        : String(rawCaption ?? "");

    const metaInput = evidenceMetaSchema.parse({ stage: rawStageValue, caption });
    const buffer = await file.toBuffer();
    return this.evidence.upload(
      auth!,
      workLogId,
      { buffer, originalName: file.filename, contentType: file.mimetype },
      metaInput.stage,
      metaInput.caption,
      meta(request),
    );
  }

  @RequireCapability("WORK_READ")
  @Get()
  list(@Query() query: Record<string, string>, @CurrentUser() auth: AuthContext | undefined) {
    const input = evidenceListSchema.parse(query);
    return this.evidence.list(auth!, input.workLogId);
  }

  @RequireCapability("WORK_READ")
  @Get(":id/download")
  async download(
    @Param("id") id: string,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.evidence.download(auth!, id, meta(request));
    return new StreamableFile(result.buffer, {
      type: result.contentType,
      disposition: `inline; filename="evidence-${id}.jpg"`,
    });
  }
}