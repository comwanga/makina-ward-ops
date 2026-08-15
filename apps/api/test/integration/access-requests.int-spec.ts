import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PrismaClient } from "@ward-ops/database";
import { testConfig } from "./test-config";
import {
  api,
  bootstrapAdmin,
  buildApp,
  createUserWithAssignment,
  login,
  resetAuthData,
} from "./test-utils";

const TEST_DB_URL = process.env.TEST_DATABASE_URL!;
const REQUEST_PASSWORD = "RequestPass-123456";

describe("access requests (integration)", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let makinaWard: { id: string };
  let mombasaCounty: { id: string };

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await buildApp(testConfig(TEST_DB_URL));
    makinaWard = await prisma.ward.findUniqueOrThrow({ where: { code: "MAKINA" } });
    mombasaCounty = await prisma.county.findUniqueOrThrow({ where: { code: "MOMBASA" } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetAuthData(prisma);
  });

  it("allows a public request and blocks duplicates", async () => {
    const response = await api(app, {
      method: "POST",
      url: "/api/v1/users/access-requests",
      payload: {
        displayName: "Jane Worker",
        email: "jane.worker@makina.test",
        password: REQUEST_PASSWORD,
        reason: "Field staff for the Makina green army",
        requestedScope: "WARD",
        requestedScopeId: makinaWard.id,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().id).toBeDefined();

    const duplicate = await api(app, {
      method: "POST",
      url: "/api/v1/users/access-requests",
      payload: {
        displayName: "Jane Worker",
        email: "jane.worker@makina.test",
        password: REQUEST_PASSWORD,
        reason: "Another reason for the same email",
      },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it("approves a request, creates the account, and lets them log in", async () => {
    const admin = await bootstrapAdmin(app);

    const created = await api(app, {
      method: "POST",
      url: "/api/v1/users/access-requests",
      payload: {
        displayName: "Jane Worker",
        email: "jane.worker@makina.test",
        password: REQUEST_PASSWORD,
        reason: "Field staff for the Makina green army",
      },
    });
    const requestId = created.json().id as string;

    const list = await api(app, {
      method: "GET",
      url: "/api/v1/users/access-requests",
      cookie: admin.cookie,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().requests.map((request: { id: string }) => request.id)).toContain(requestId);

    const approve = await api(app, {
      method: "POST",
      url: `/api/v1/users/access-requests/${requestId}/review`,
      cookie: admin.cookie,
      csrf: admin.csrf,
      payload: {
        action: "approve",
        roleCode: "READ_ONLY",
        scopeType: "WARD",
        scopeId: makinaWard.id,
      },
    });
    expect(approve.statusCode).toBe(201);
    expect(approve.json().status).toBe("APPROVED");

    const user = await prisma.user.findUnique({ where: { email: "jane.worker@makina.test" } });
    expect(user).not.toBeNull();
    expect(user!.mustChangePassword).toBe(true);

    const session = await login(app, "jane.worker@makina.test", REQUEST_PASSWORD);
    expect(session.user?.email).toBe("jane.worker@makina.test");

    const me = await api(app, {
      method: "GET",
      url: "/api/v1/auth/me",
      cookie: session.cookie,
    });
    expect(me.json().user.assignments[0].role).toBe("READ_ONLY");
  });

  it("rejects without creating an account", async () => {
    const admin = await bootstrapAdmin(app);
    const created = await api(app, {
      method: "POST",
      url: "/api/v1/users/access-requests",
      payload: {
        displayName: "Jane Worker",
        email: "jane.worker@makina.test",
        password: REQUEST_PASSWORD,
        reason: "Field staff for the Makina green army",
      },
    });
    const requestId = created.json().id as string;

    const rejected = await api(app, {
      method: "POST",
      url: `/api/v1/users/access-requests/${requestId}/review`,
      cookie: admin.cookie,
      csrf: admin.csrf,
      payload: { action: "reject", note: "no vacancy" },
    });
    expect(rejected.statusCode).toBe(201);
    expect(rejected.json().status).toBe("REJECTED");

    const user = await prisma.user.findUnique({ where: { email: "jane.worker@makina.test" } });
    expect(user).toBeNull();
  });

  it("denies non-admins and out-of-scope approvals", async () => {
    await bootstrapAdmin(app);
    const created = await api(app, {
      method: "POST",
      url: "/api/v1/users/access-requests",
      payload: {
        displayName: "Jane Worker",
        email: "jane.worker@makina.test",
        password: REQUEST_PASSWORD,
        reason: "Field staff for the Makina green army",
      },
    });
    const requestId = created.json().id as string;

    await createUserWithAssignment(prisma, {
      email: "officer@makina.test",
      password: "OfficerPass-123",
      displayName: "Officer",
      roleCode: "WARD_OFFICER",
      scopeType: "WARD",
      scopeId: makinaWard.id,
    });
    const officer = await login(app, "officer@makina.test", "OfficerPass-123");
    const denied = await api(app, {
      method: "POST",
      url: `/api/v1/users/access-requests/${requestId}/review`,
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: { action: "approve", roleCode: "READ_ONLY", scopeType: "WARD", scopeId: makinaWard.id },
    });
    expect(denied.statusCode).toBe(403);

    await createUserWithAssignment(prisma, {
      email: "mombasa.admin@makina.test",
      password: "MombasaPass-123",
      displayName: "Mombasa Admin",
      roleCode: "SYSTEM_ADMIN",
      scopeType: "COUNTY",
      scopeId: mombasaCounty.id,
    });
    const mombasaAdmin = await login(app, "mombasa.admin@makina.test", "MombasaPass-123");
    const outOfScope = await api(app, {
      method: "POST",
      url: `/api/v1/users/access-requests/${requestId}/review`,
      cookie: mombasaAdmin.cookie,
      csrf: mombasaAdmin.csrf,
      payload: { action: "approve", roleCode: "READ_ONLY", scopeType: "WARD", scopeId: makinaWard.id },
    });
    expect(outOfScope.statusCode).toBe(403);
  });
});