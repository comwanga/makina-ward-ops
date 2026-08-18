import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PrismaClient } from "@ward-ops/database";
import { testConfig } from "./test-config";
import {
  api,
  buildApp,
  createUserWithAssignment,
  login,
  resetAuthData,
} from "./test-utils";

const TEST_DB_URL = process.env.TEST_DATABASE_URL!;
const PASSWORD = "TestPass-123456";

describe("audit history (integration)", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;

  let makinaWard: { id: string; code: string };
  let nccCounty: { id: string };
  let likoniSubcounty: { id: string };

  let officer: { cookie: string | null; csrf: string | null };
  let admin: { cookie: string | null; csrf: string | null };
  let likoniReviewer: { cookie: string | null; csrf: string | null };

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await buildApp(testConfig(TEST_DB_URL));
    makinaWard = await prisma.ward.findUniqueOrThrow({ where: { code: "MAKINA" } });
    nccCounty = await prisma.county.findUniqueOrThrow({ where: { code: "NCC" } });
    likoniSubcounty = await prisma.subcounty.findUniqueOrThrow({ where: { code: "LIKONI" } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetAuthData(prisma);
    await prisma.employeeProfile.deleteMany();
    await prisma.employee.deleteMany();

    await createUserWithAssignment(prisma, {
      email: "officer@makina.test",
      password: PASSWORD,
      displayName: "Ward Officer",
      roleCode: "WARD_OFFICER",
      scopeType: "WARD",
      scopeId: makinaWard.id,
    });
    officer = await login(app, "officer@makina.test", PASSWORD);

    await createUserWithAssignment(prisma, {
      email: "admin@makina.test",
      password: PASSWORD,
      displayName: "System Admin",
      roleCode: "SYSTEM_ADMIN",
      scopeType: "COUNTY",
      scopeId: nccCounty.id,
    });
    admin = await login(app, "admin@makina.test", PASSWORD);

    await createUserWithAssignment(prisma, {
      email: "reviewer@likoni.test",
      password: PASSWORD,
      displayName: "Likoni Reviewer",
      roleCode: "SUBCOUNTY_REVIEWER",
      scopeType: "SUBCOUNTY",
      scopeId: likoniSubcounty.id,
    });
    likoniReviewer = await login(app, "reviewer@likoni.test", PASSWORD);
  });

  it("requires the AUDIT_READ capability", async () => {
    const response = await api(app, {
      method: "GET",
      url: "/api/v1/audit",
      cookie: officer.cookie,
    });
    expect(response.statusCode).toBe(403);
  });

  it("lists scoped audit events to an authorised reader", async () => {
    const createResponse = await api(app, {
      method: "POST",
      url: "/api/v1/staff",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: {
        employeeNumber: "20260466001",
        fullName: "Audit Worker",
        phone: "0799000001",
        designation: "Green Army Staff",
        wardId: makinaWard.id,
      },
    });
    expect(createResponse.statusCode).toBe(201);

    const listResponse = await api(app, {
      method: "GET",
      url: "/api/v1/audit",
      cookie: admin.cookie,
    });
    expect(listResponse.statusCode).toBe(200);
    const body = listResponse.json();
    expect(body.items).toBeInstanceOf(Array);
    const actions = body.items.map((event: { action: string }) => event.action);
    expect(actions).toContain("EMPLOYEE.CREATED");
  });

  it("does not leak another scope's audit events to a subcounty reviewer", async () => {
    const createResponse = await api(app, {
      method: "POST",
      url: "/api/v1/staff",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: {
        employeeNumber: "20260466002",
        fullName: "Audit Worker Two",
        phone: "0799000002",
        designation: "Green Army Staff",
        wardId: makinaWard.id,
      },
    });
    expect(createResponse.statusCode).toBe(201);

    const listResponse = await api(app, {
      method: "GET",
      url: "/api/v1/audit",
      cookie: likoniReviewer.cookie,
    });
    expect(listResponse.statusCode).toBe(200);
    const body = listResponse.json();
    const actions = body.items.map((event: { action: string }) => event.action);
    expect(actions).not.toContain("EMPLOYEE.CREATED");
  });
});
