import { Body, Controller, Get, Param, Post, Query, Req, StreamableFile } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  reportAiDraftSchema,
  reportFinalizeSchema,
  reportPreviewQuerySchema,
  reportQuerySchema,
} from "@ward-ops/validation";
import { RequireCapability } from "../authorization/capability.decorator";
import { CurrentUser, AuthContext } from "../auth/auth-context";
import { ReportService, RequestMeta } from "./report.service";

function meta(request: FastifyRequest): RequestMeta {
  return {
    sourceIp: request.ip,
    requestId: request.headers["x-request-id"] as string | undefined,
  };
}

@Controller("reports")
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @RequireCapability("REPORTS_READ")
  @Get()
  list(@Query() query: Record<string, string>, @CurrentUser() auth: AuthContext | undefined) {
    const input = reportQuerySchema.parse(query);
    return this.reports.list(auth!, input);
  }

  @RequireCapability("REPORTS_READ")
  @Get("preview")
  preview(@Query() query: Record<string, string>, @CurrentUser() auth: AuthContext | undefined) {
    const input = reportPreviewQuerySchema.parse(query);
    return this.reports.preview(auth!, input);
  }

  @RequireCapability("REPORTS_FINALIZE")
  @Post("ai-draft")
  aiDraft(
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = reportAiDraftSchema.parse(body);
    return this.reports.aiDraft(auth!, input, meta(request));
  }

  @RequireCapability("REPORTS_FINALIZE")
  @Post()
  finalize(
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = reportFinalizeSchema.parse(body);
    return this.reports.finalize(auth!, input, meta(request));
  }

  @RequireCapability("REPORTS_READ")
  @Get(":id")
  get(@Param("id") id: string, @CurrentUser() auth: AuthContext | undefined) {
    return this.reports.get(auth!, id);
  }

  @RequireCapability("REPORTS_READ")
  @Get(":id/csv")
  async csv(
    @Param("id") id: string,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.reports.exportCsv(auth!, id, meta(request));
    return new StreamableFile(result.buffer, {
      type: "text/csv; charset=utf-8",
      disposition: `attachment; filename="${result.filename}"`,
    });
  }
}