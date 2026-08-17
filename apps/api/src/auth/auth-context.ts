import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { CapabilityCode, RoleCode, ScopeType } from "@ward-ops/contracts";

export const SESSION_COOKIE = "ward_session";
export const CSRF_HEADER = "x-csrf-token";
export const AUTH_CONTEXT = Symbol.for("ward_ops.auth_context");

export interface AuthAssignment {
  id: string;
  role: RoleCode;
  roleName: string;
  scopeType: ScopeType;
  countyId: string | null;
  subcountyId: string | null;
  wardId: string | null;
}

export interface AuthContext {
  userId: string;
  email: string;
  displayName: string;
  sessionId: string;
  csrfToken: string;
  capabilities: CapabilityCode[];
  assignments: AuthAssignment[];
}

export function readAuthContext(request: FastifyRequest): AuthContext | undefined {
  return (request as unknown as Record<symbol, AuthContext>)[AUTH_CONTEXT];
}

export function setAuthContext(request: FastifyRequest, context: AuthContext): void {
  (request as unknown as Record<symbol, AuthContext>)[AUTH_CONTEXT] = context;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext | undefined => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    return readAuthContext(request);
  },
);

export function sessionExpiry(config: { sessionHours: number }): Date {
  return new Date(Date.now() + config.sessionHours * 60 * 60 * 1000);
}