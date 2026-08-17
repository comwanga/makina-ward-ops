import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PrismaClient } from "@ward-ops/database";
import { testConfig } from "./test-config";
import {
  api,
  buildApp,
  createEmployee,
  createUserWithAssignment,
  login,
  resetAuthData,
} from "./test-utils";

const TEST_DB_URL = process.env.TEST_DATABASE_URL!;
const PASSWORD = "TestPass-123456";

describe("staff management (integration)", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;

  let makinaWard: { id: string; code: string };
  let woodleyWard: { id: string; code: string };
  let nccCounty: { id: string };

  let officer: { cookie: string | null; csrf: string | null };
  let admin: { cookie: string | null; csrf: string | null };

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await buildApp(testConfig(TEST_DB_URL));
    makinaWard = await prisma.ward.findUniqueOrThrow({ where: { code: "MAKINA" } });
    woodleyWard = await prisma.ward.findUniqueOrThrow({ where: { code: "WOODLEY" } });
    nccCounty = await prisma.county.findUniqueOrThrow({ where: { code: "NCC" } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetAuthData(prisma);
    await prisma.employeeProfile.deleteMany();
    await prisma.employee.deleteMany();
    const officerUserId = await createUserWithAssignment(prisma, {
      email: "officer@makina.test",
      password: PASSWORD,
      displayName: "Ward Officer",
      roleCode: "WARD_OFFICER",
      scopeType: "WARD",
      scopeId: makinaWard.id,
    });
    officer = await login(app, "officer@makina.test", PASSWORD);
    expect(officer.user).toBeDefined();
    expect(officer.cookie).toBeTruthy();

    const adminUserId = await createUserWithAssignment(prisma, {
      email: "admin@makina.test",
      password: PASSWORD,
      displayName: "System Admin",
      roleCode: "SYSTEM_ADMIN",
      scopeType: "COUNTY",
      scopeId: nccCounty.id,
    });
    admin = await login(app, "admin@makina.test", PASSWORD);
    expect(admin.cookie).toBeTruthy();
    void officerUserId;
    void adminUserId;
  });

  it("creates staff in the assigned ward", async () => {
    const response = await api(app, {
      method: "POST",
      url: "/api/v1/staff",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: {
        employeeNumber: "20250100001",
        fullName: "Amina Hassan",
        phone: "0711000001",
        email: "amina@makina.test",
        designation: "Green Army Staff",
        wardId: makinaWard.id,
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.employeeNumber).toBe("20250100001");
    expect(body.ward.id).toBe(makinaWard.id);
    expect(body.profile.rosterStatus).toBe("ON_DUTY");

    const audit = await prisma.auditEvent.count({
      where: { action: "EMPLOYEE.CREATED" },
    });
    expect(audit).toBeGreaterThanOrEqual(1);
  });

  it("rejects duplicate employee numbers and phones", async () => {
    const payload = {
      employeeNumber: "20250100002",
      fullName: "Brian Otieno",
      phone: "0711000002",
      wardId: makinaWard.id,
    };
    await api(app, {
      method: "POST",
      url: "/api/v1/staff",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload,
    });

    const duplicateNumber = await api(app, {
      method: "POST",
      url: "/api/v1/staff",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: { ...payload, phone: "0711999999" },
    });
    expect(duplicateNumber.statusCode).toBe(409);

    const duplicatePhone = await api(app, {
      method: "POST",
      url: "/api/v1/staff",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: { ...payload, employeeNumber: "20250100003" },
    });
    expect(duplicatePhone.statusCode).toBe(409);
  });

  it("cannot create staff in another ward", async () => {
    const response = await api(app, {
      method: "POST",
      url: "/api/v1/staff",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: {
        employeeNumber: "20250100004",
        fullName: "Cross Ward",
        phone: "0711000004",
        wardId: woodleyWard.id,
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it("lists only staff within the officer's ward", async () => {
    await createEmployee(prisma, {
      employeeNumber: "20250100010",
      fullName: "Makina Staff",
      phone: "0712000010",
      wardId: makinaWard.id,
    });
    await createEmployee(prisma, {
      employeeNumber: "20250100011",
      fullName: "Woodley Staff",
      phone: "0712000011",
      wardId: woodleyWard.id,
    });

    const response = await api(app, {
      method: "GET",
      url: "/api/v1/staff",
      cookie: officer.cookie,
    });
    expect(response.statusCode).toBe(200);
    const list = response.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(1);
    expect(list[0].employeeNumber).toBe("20250100010");
  });

  it("blocks reading another ward's employee", async () => {
    const woodleyEmployeeId = await createEmployee(prisma, {
      employeeNumber: "20250100012",
      fullName: "Woodley Staff",
      phone: "0712000012",
      wardId: woodleyWard.id,
    });
    const response = await api(app, {
      method: "GET",
      url: `/api/v1/staff/${woodleyEmployeeId}`,
      cookie: officer.cookie,
    });
    expect(response.statusCode).toBe(403);
  });

  it("updates, deactivates and reactivates staff", async () => {
    const employeeId = await createEmployee(prisma, {
      employeeNumber: "20250100013",
      fullName: "Updateable Staff",
      phone: "0712000013",
      wardId: makinaWard.id,
    });

    const updated = await api(app, {
      method: "PATCH",
      url: `/api/v1/staff/${employeeId}`,
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: { fullName: "Updated Name", residence: "Makina" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().fullName).toBe("Updated Name");
    expect(updated.json().profile.residence).toBe("Makina");

    const deactivated = await api(app, {
      method: "POST",
      url: `/api/v1/staff/${employeeId}/deactivate`,
      cookie: officer.cookie,
      csrf: officer.csrf,
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json().active).toBe(false);

    const reactivated = await api(app, {
      method: "POST",
      url: `/api/v1/staff/${employeeId}/reactivate`,
      cookie: officer.cookie,
      csrf: officer.csrf,
    });
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json().active).toBe(true);
  });

  it("assigns staff to another ward within a county scope", async () => {
    const employeeId = await createEmployee(prisma, {
      employeeNumber: "20250100014",
      fullName: "Assignable Staff",
      phone: "0712000014",
      wardId: makinaWard.id,
    });

    const response = await api(app, {
      method: "POST",
      url: `/api/v1/staff/${employeeId}/assignments`,
      cookie: admin.cookie,
      csrf: admin.csrf,
      payload: { wardId: woodleyWard.id },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.assignments.some((a: { wardId: string }) => a.wardId === woodleyWard.id)).toBe(true);
  });

  it("rejects duplicate assignment and assignment to home ward", async () => {
    const employeeId = await createEmployee(prisma, {
      employeeNumber: "20250100015",
      fullName: "Duplicate Assign",
      phone: "0712000015",
      wardId: makinaWard.id,
    });

    const toHome = await api(app, {
      method: "POST",
      url: `/api/v1/staff/${employeeId}/assignments`,
      cookie: admin.cookie,
      csrf: admin.csrf,
      payload: { wardId: makinaWard.id },
    });
    expect(toHome.statusCode).toBe(409);

    await api(app, {
      method: "POST",
      url: `/api/v1/staff/${employeeId}/assignments`,
      cookie: admin.cookie,
      csrf: admin.csrf,
      payload: { wardId: woodleyWard.id },
    });
    const duplicate = await api(app, {
      method: "POST",
      url: `/api/v1/staff/${employeeId}/assignments`,
      cookie: admin.cookie,
      csrf: admin.csrf,
      payload: { wardId: woodleyWard.id },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it("requires STAFF_MANAGE for mutations", async () => {
    const response = await api(app, {
      method: "POST",
      url: "/api/v1/staff",
      payload: {
        employeeNumber: "20250100016",
        fullName: "No Permission",
        phone: "0712000016",
        wardId: makinaWard.id,
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects malformed input with 422 instead of 500", async () => {
    const badWard = await api(app, {
      method: "POST",
      url: "/api/v1/staff",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: {
        employeeNumber: "20250100017",
        fullName: "Bad Ward",
        phone: "0712000017",
        wardId: "not-a-cuid",
      },
    });
    expect(badWard.statusCode).toBe(422);
    expect(badWard.json().error.code).toBe("VALIDATION_FAILED");

    const badPhone = await api(app, {
      method: "POST",
      url: "/api/v1/staff",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: {
        employeeNumber: "20250100017",
        fullName: "Bad Phone",
        phone: "not-a-phone",
        wardId: makinaWard.id,
      },
    });
    expect(badPhone.statusCode).toBe(422);
  });
});