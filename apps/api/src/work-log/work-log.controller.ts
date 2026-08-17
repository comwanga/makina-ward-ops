import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  createWorkLogSchema,
  workLogActionSchema,
  workLogQuerySchema,
} from "@ward-ops/validation";
import { RequireCapability } from "../authorization/capability.decorator";
import { CurrentUser, AuthContext } from "../auth/auth-context";
import { WorkLogService, RequestMeta } from "./work-log.service";

function meta(request: FastifyRequest): RequestMeta {
  return {
    sourceIp: request.ip,
    requestId: request.headers["x-request-id"] as string | undefined,
  };
}

@Controller("work-logs")
export class WorkLogController {
  constructor(private readonly workLog: WorkLogService) {}

  @RequireCapability("WORK_CREATE")
  @Post()
  create(
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = createWorkLogSchema.parse(body);
    return this.workLog.create(auth!, input, meta(request));
  }

  @RequireCapability("WORK_READ")
  @Get()
  list(@Query() query: Record<string, string>, @CurrentUser() auth: AuthContext | undefined) {
    const input = workLogQuerySchema.parse(query);
    return this.workLog.list(auth!, input);
  }

  @RequireCapability("WORK_READ")
  @Get(":id")
  get(@Param("id") id: string, @CurrentUser() auth: AuthContext | undefined) {
    return this.workLog.get(auth!, id);
  }

  @Post(":id/actions")
  action(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = workLogActionSchema.parse(body);
    return this.workLog.action(auth!, id, input, meta(request));
  }
}