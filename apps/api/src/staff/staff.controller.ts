import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  createEmployeeAssignmentSchema,
  createEmployeeSchema,
  updateEmployeeSchema,
} from "@ward-ops/validation";
import { RequireCapability } from "../authorization/capability.decorator";
import { CurrentUser, AuthContext } from "../auth/auth-context";
import { StaffService } from "./staff.service";

@Controller("staff")
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @RequireCapability("STAFF_READ")
  @Get()
  list(@CurrentUser() auth: AuthContext | undefined) {
    return this.staff.list(auth!);
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
    return this.staff.create(auth!, input, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
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
    return this.staff.update(auth!, id, input, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
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
    return this.staff.assign(auth!, id, input, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
  }

  @RequireCapability("STAFF_MANAGE")
  @HttpCode(HttpStatus.OK)
  @Post(":id/deactivate")
  deactivate(
    @Param("id") id: string,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    return this.staff.setActive(auth!, id, false, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
  }

  @RequireCapability("STAFF_MANAGE")
  @HttpCode(HttpStatus.OK)
  @Post(":id/reactivate")
  reactivate(
    @Param("id") id: string,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    return this.staff.setActive(auth!, id, true, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
  }
}