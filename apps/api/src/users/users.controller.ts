import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  accessRequestDecisionSchema,
  accessRequestSchema,
  adminPasswordResetSchema,
  updateRoleCapabilitiesSchema,
  updateUserAssignmentsSchema,
} from "@ward-ops/validation";
import { Public } from "../common/public.decorator";
import { RequireCapability } from "../authorization/capability.decorator";
import { CurrentUser, AuthContext } from "../auth/auth-context";
import { UsersService } from "./users.service";

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Public()
  @Post("access-requests")
  async requestAccess(@Body() body: unknown, @Req() request: FastifyRequest) {
    const input = accessRequestSchema.parse(body);
    const result = await this.users.requestAccess(input, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
    return result;
  }

  @RequireCapability("USERS_READ")
  @Get()
  async list(@CurrentUser() auth: AuthContext | undefined) {
    return { users: await this.users.listUsers(auth!) };
  }

  @RequireCapability("USERS_MANAGE")
  @Get("access-requests")
  async listAccessRequests(@CurrentUser() auth: AuthContext | undefined) {
    const requests = await this.users.listAccessRequests(auth!);
    return { requests };
  }

  @RequireCapability("USERS_MANAGE")
  @Post("access-requests/:id/review")
  async review(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = accessRequestDecisionSchema.parse(body);
    const result = await this.users.reviewAccessRequest(auth!, id, input, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
    return result;
  }

  @RequireCapability("USERS_DISABLE")
  @HttpCode(HttpStatus.OK)
  @Post(":id/disable")
  async disable(
    @Param("id") id: string,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    await this.users.setUserActive(auth!, id, false, this.meta(request));
    return { ok: true };
  }

  @RequireCapability("PERMISSIONS_MANAGE")
  @Get("permissions")
  permissions() {
    return this.users.permissionCatalog();
  }

  @RequireCapability("PERMISSIONS_MANAGE")
  @HttpCode(HttpStatus.OK)
  @Put("roles/:roleCode/capabilities")
  async updateRoleCapabilities(
    @Param("roleCode") roleCode: string,
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = updateRoleCapabilitiesSchema.parse(body);
    await this.users.updateRoleCapabilities(auth!, roleCode as never, input, this.meta(request));
    return { ok: true };
  }

  @RequireCapability("USERS_DISABLE")
  @HttpCode(HttpStatus.OK)
  @Post(":id/restore")
  async restore(
    @Param("id") id: string,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    await this.users.setUserActive(auth!, id, true, this.meta(request));
    return { ok: true };
  }

  @RequireCapability("SCOPE_MANAGE")
  @HttpCode(HttpStatus.OK)
  @Put(":id/assignments")
  async updateAssignments(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = updateUserAssignmentsSchema.parse(body);
    await this.users.updateAssignments(auth!, id, input, this.meta(request));
    return { ok: true };
  }

  @RequireCapability("USERS_DISABLE")
  @HttpCode(HttpStatus.OK)
  @Post(":id/reset-password")
  async resetPassword(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ) {
    const input = adminPasswordResetSchema.parse(body);
    await this.users.resetPassword(auth!, id, input.temporaryPassword, this.meta(request));
    return { ok: true };
  }

  private meta(request: FastifyRequest) {
    return {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    };
  }
}
