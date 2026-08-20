import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { bootstrapSchema, changePasswordSchema, loginSchema } from "@ward-ops/validation";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/config";
import { Public } from "../common/public.decorator";
import { AuthService } from "./auth.service";
import { CurrentUser, SESSION_COOKIE, AuthContext } from "./auth-context";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post("bootstrap")
  async bootstrap(@Body() body: unknown, @Req() request: FastifyRequest) {
    const input = bootstrapSchema.parse(body);
    const user = await this.auth.bootstrapAdmin(input, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
    return { user };
  }

  @Public()
  @Post("login")
  async login(@Body() body: unknown, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const input = loginSchema.parse(body);
    const result = await this.auth.login(input, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
    reply.setCookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: this.config.secureCookies,
      sameSite: "lax",
      path: "/",
      expires: result.expiresAt,
    });
    return { csrfToken: result.csrfToken, expiresAt: result.expiresAt, user: result.user };
  }

  @HttpCode(HttpStatus.OK)
  @Post("logout")
  async logout(@CurrentUser() auth: AuthContext | undefined, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    if (auth) {
      await this.auth.logout(auth.sessionId, {
        sourceIp: request.ip,
        requestId: request.headers["x-request-id"] as string | undefined,
      });
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  }

  @Get("me")
  async me(@CurrentUser() auth: AuthContext | undefined) {
    if (!auth) {
      return { user: null };
    }
    const user = await this.auth.me(auth);
    return { user };
  }

  @HttpCode(HttpStatus.OK)
  @Post("change-password")
  async changePassword(@CurrentUser() auth: AuthContext | undefined, @Body() body: unknown, @Req() request: FastifyRequest) {
    const input = changePasswordSchema.parse(body);
    await this.auth.changePassword(auth!, input, {
      sourceIp: request.ip,
      requestId: request.headers["x-request-id"] as string | undefined,
    });
    return { ok: true };
  }
}