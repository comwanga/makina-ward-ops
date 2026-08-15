import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { IS_PUBLIC_KEY } from "../common/public.decorator";
import { REQUIRED_CAPABILITIES_KEY } from "./capability.decorator";
import { readAuthContext } from "../auth/auth-context";

@Injectable()
export class CapabilitiesGuard implements CanActivate {
  private readonly reflector = new Reflector();

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_CAPABILITIES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = readAuthContext(request);
    if (!auth) {
      throw new ForbiddenException("Not permitted");
    }
    const granted = new Set(auth.capabilities);
    const missing = required.filter((capability) => !granted.has(capability as never));
    if (missing.length > 0) {
      throw new ForbiddenException("You do not have permission for this action");
    }
    return true;
  }
}