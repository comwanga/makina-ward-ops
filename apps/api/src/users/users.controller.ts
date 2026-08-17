import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  accessRequestDecisionSchema,
  accessRequestSchema,
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
}