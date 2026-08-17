import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { tokensEqual } from "../common/crypto";
import { IS_PUBLIC_KEY } from "../common/public.decorator";
import { CSRF_HEADER, readAuthContext } from "./auth-context";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly reflector = new Reflector();

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      return true;
    }

    const auth = readAuthContext(request);
    if (!auth) {
      return true;
    }
    const submitted = request.headers[CSRF_HEADER] as string | undefined;
    if (!tokensEqual(submitted, auth.csrfToken)) {
      throw new ForbiddenException("Invalid form security token");
    }
    return true;
  }
}