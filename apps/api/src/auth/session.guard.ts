import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { PrismaService } from "../prisma/prisma.service";
import { hashToken } from "../common/crypto";
import { IS_PUBLIC_KEY } from "../common/public.decorator";
import {
  AUTH_CONTEXT,
  AuthContext,
  SESSION_COOKIE,
  setAuthContext,
} from "./auth-context";

const PASSWORD_CHANGE_EXEMPT = ["/auth/me", "/auth/change-password", "/auth/logout"];

@Injectable()
export class SessionAuthGuard implements CanActivate {
  private readonly reflector = new Reflector();

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const rawToken = request.cookies?.[SESSION_COOKIE];
    let mustChangePassword = false;
    if (rawToken) {
      const session = await this.prisma.client.userSession.findUnique({
        where: { tokenHash: hashToken(rawToken) },
        include: {
          user: {
            include: {
              assignments: {
                include: {
                  role: {
                    include: { capabilities: { include: { capability: true } } },
                  },
                },
              },
            },
          },
        },
      });
      if (
        session &&
        !session.revokedAt &&
        session.expiresAt > new Date() &&
        session.user.active
      ) {
        mustChangePassword = session.user.mustChangePassword;
        const contextValue: AuthContext = {
          userId: session.userId,
          email: session.user.email,
          displayName: session.user.displayName,
          sessionId: session.id,
          csrfToken: session.csrfToken,
          capabilities: Array.from(
            new Set(
              session.user.assignments.flatMap((assignment) =>
                assignment.role.capabilities.map((link) => link.capability.code as AuthContext["capabilities"][number]),
              ),
            ),
          ),
          assignments: session.user.assignments.map((assignment) => ({
            id: assignment.id,
            role: assignment.role.code as AuthContext["assignments"][number]["role"],
            roleName: assignment.role.name,
            scopeType: assignment.scopeType,
            countyId: assignment.countyId,
            subcountyId: assignment.subcountyId,
            wardId: assignment.wardId,
          })),
        };
        setAuthContext(request, contextValue);
      }
    }

    if (isPublic) {
      return true;
    }
    if (!readContext(request)) {
      throw new UnauthorizedException("Authentication required");
    }
    if (mustChangePassword && !PASSWORD_CHANGE_EXEMPT.some((path) => request.url.endsWith(path))) {
      throw new ForbiddenException("Password change required before continuing");
    }
    return true;
  }
}

function readContext(request: FastifyRequest): AuthContext | undefined {
  return (request as unknown as Record<symbol, AuthContext>)[AUTH_CONTEXT];
}