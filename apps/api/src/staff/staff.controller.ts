import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  createEmployeeAssignmentSchema,
  createEmployeeSchema,
  commitStaffImportSchema,
  staffImportHistoryQuerySchema,
  staffImportPreviewMetaSchema,
  staffQuerySchema,
  updateEmployeeSchema,
} from "@ward-ops/validation";
import { RequireCapability } from "../authorization/capability.decorator";
import { CurrentUser, AuthContext } from "../auth/auth-context";
import { StaffService } from "./staff.service";
import { parseStaffImport } from "./staff-import";

function requestMeta(request: FastifyRequest) {
  return {
    sourceIp: request.ip,
    requestId: request.headers["x-request-id"] as string | undefined,
  };
}

@Controller("staff")
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @RequireCapability("STAFF_READ")
  @Get()
  list(@Query() query: Record<string, string>, @CurrentUser() auth: AuthContext | undefined) {
    return this.staff.list(auth!, staffQuerySchema.parse(query));
  }

  @RequireCapability("STAFF_IMPORT")
  @Post("imports/preview")
  async previewImport(
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    if (!request.isMultipart()) throw new BadRequestException("Expected a CSV or XLSX roster upload");
    let wardIdValue = "";
    let filename = "";
    let content: Buffer | undefined;
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (content) throw new BadRequestException("Supply exactly one roster file");
        filename = part.filename;
        content = await part.toBuffer();
      } else if (part.fieldname === "wardId") {
        wardIdValue = String(part.value);
      }
    }
    if (!content) throw new BadRequestException("No roster file supplied");
    const { wardId } = staffImportPreviewMetaSchema.parse({ wardId: wardIdValue });
    let rows;
    try {
      rows = await parseStaffImport(content, filename);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Roster could not be parsed");
    }
    if (rows.length === 0) throw new BadRequestException("Roster contains no staff rows");
    return this.staff.previewImport(auth!, wardId, rows, filename, requestMeta(request));
  }

  @RequireCapability("STAFF_IMPORT")
  @Post("imports/commit")
  commitImport(
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    return this.staff.commitImport(auth!, commitStaffImportSchema.parse(body), requestMeta(request));
  }

  @RequireCapability("STAFF_IMPORT")
  @Get("imports/history")
  importHistory(
    @Query() query: Record<string, string>,
    @CurrentUser() auth: AuthContext | undefined,
  ) {
    return this.staff.importHistory(auth!, staffImportHistoryQuerySchema.parse(query));
  }

  @RequireCapability("STAFF_READ")
  @Get(":id")
  get(@Param("id") id: string, @CurrentUser() auth: AuthContext | undefined) {
    return this.staff.get(auth!, id);
  }

  @RequireCapability("STAFF_MANAGE")
  @Post()
  create(
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = createEmployeeSchema.parse(body);
    return this.staff.create(auth!, input, requestMeta(request));
  }

  @RequireCapability("STAFF_MANAGE")
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = updateEmployeeSchema.parse(body);
    return this.staff.update(auth!, id, input, requestMeta(request));
  }

  @RequireCapability("STAFF_MANAGE")
  @Post(":id/assignments")
  assign(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = createEmployeeAssignmentSchema.parse(body);
    return this.staff.assign(auth!, id, input, requestMeta(request));
  }

  @RequireCapability("STAFF_MANAGE")
  @HttpCode(HttpStatus.OK)
  @Post(":id/assignments/:assignmentId/end")
  endAssignment(
    @Param("id") id: string,
    @Param("assignmentId") assignmentId: string,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    return this.staff.endAssignment(auth!, id, assignmentId, requestMeta(request));
  }

  @RequireCapability("STAFF_MANAGE")
  @HttpCode(HttpStatus.OK)
  @Post(":id/deactivate")
  deactivate(
    @Param("id") id: string,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    return this.staff.setActive(auth!, id, false, requestMeta(request));
  }

  @RequireCapability("STAFF_MANAGE")
  @HttpCode(HttpStatus.OK)
  @Post(":id/reactivate")
  reactivate(
    @Param("id") id: string,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    return this.staff.setActive(auth!, id, true, requestMeta(request));
  }
}
