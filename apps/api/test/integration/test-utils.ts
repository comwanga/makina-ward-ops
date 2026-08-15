import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { PrismaClient } from "@ward-ops/database";
import { AppModule } from "../../dist/app.module";
import { configureApp } from "../../dist/main";
import { APP_CONFIG } from "../../dist/config/config.module";
import type { AppConfig } from "../../dist/config/config";
import { hashPassword } from "../../dist/common/crypto";

export async function buildApp(config: AppConfig): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ trustProxy: true, logger: false }),
  );
  await configureApp(app, config);
  await app.init();
  return app;
}

export function extractCookie(
  setCookie: string | string[] | undefined,
  name: string,
): string | null {
  if (!setCookie) return null;
  const entries = Array.isArray(setCookie) ? setCookie : setCookie.split(",");
  for (const entry of entries) {
    const [pair] = entry.split(";");
    const separator = pair.indexOf("=");
    if (separator > 0 && pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim();
    }
  }
  return null;
}

export interface LoginSession {
  cookie: string | null;
  csrf: string | null;
  user: { id: string; email: string; displayName: string } | undefined;
}

export async function login(
  app: NestFastifyApplication,
  email: string,
  password: string,
): Promise<LoginSession> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
  const cookie = extractCookie(response.headers["set-cookie"], "ward_session");
  const body = response.json();
  return {
    cookie: cookie ? `ward_session=${cookie}` : null,
    csrf: body.csrfToken ?? null,
    user: body.user,
  };
}

export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  cookie?: string | null;
  csrf?: string | null;
  payload?: unknown;
}

export function api(
  app: NestFastifyApplication,
  options: RequestOptions,
) {
  const headers: Record<string, string> = {};
  if (options.cookie) {
    headers["cookie"] = options.cookie;
  }
  if (options.csrf && options.method !== "GET") {
    headers["x-csrf-token"] = options.csrf;
  }
  return app.inject({
    method: options.method,
    url: options.url,
    headers,
    payload: options.payload as object | undefined,
  });
}

/** Removes session/auth-derived rows so each spec starts clean. */
export async function resetAuthData(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction([
    prisma.userSession.deleteMany(),
    prisma.auditEvent.deleteMany(),
    prisma.accessRequest.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

export async function bootstrapAdmin(
  app: NestFastifyApplication,
  options: { email?: string; password?: string; setupToken?: string } = {},
): Promise<LoginSession> {
  const email = options.email ?? "admin@makina.test";
  const password = options.password ?? "AdminOnly-123";
  const setupToken = options.setupToken ?? "test-setup-token";
  const response = await api(app, {
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: { setupToken, email, password, displayName: "System Owner" },
  });
  if (response.statusCode !== 201 && response.statusCode !== 200) {
    throw new Error(`bootstrap failed: ${response.statusCode} ${response.body}`);
  }
  return login(app, email, password);
}

export async function createUserWithAssignment(
  prisma: PrismaClient,
  input: {
    email: string;
    password: string;
    displayName: string;
    roleCode: "SYSTEM_ADMIN" | "WARD_OFFICER" | "SUBCOUNTY_REVIEWER" | "HR_VIEWER" | "READ_ONLY";
    scopeType: "COUNTY" | "SUBCOUNTY" | "WARD";
    scopeId: string;
  },
): Promise<string> {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: input.roleCode } });
  const user = await prisma.user.create({
    data: {
      email: input.email,
      displayName: input.displayName,
      passwordHash: hashPassword(input.password),
      active: true,
      mustChangePassword: false,
      assignments: {
        create: {
          roleId: role.id,
          scopeType: input.scopeType,
          countyId: input.scopeType === "COUNTY" ? input.scopeId : null,
          subcountyId: input.scopeType === "SUBCOUNTY" ? input.scopeId : null,
          wardId: input.scopeType === "WARD" ? input.scopeId : null,
        },
      },
    },
  });
  return user.id;
}

export async function createEmployee(
  prisma: PrismaClient,
  input: {
    employeeNumber: string;
    fullName: string;
    phone: string;
    wardId: string;
    active?: boolean;
    rosterStatus?: "ON_DUTY" | "ANNUAL_LEAVE";
  },
): Promise<string> {
  const employee = await prisma.employee.create({
    data: {
      employeeNumber: input.employeeNumber,
      fullName: input.fullName,
      phone: input.phone,
      designation: "Green Army Staff",
      active: input.active ?? true,
      wardId: input.wardId,
      profile: {
        create: { residence: null, rosterStatus: input.rosterStatus ?? "ON_DUTY" },
      },
    },
  });
  return employee.id;
}