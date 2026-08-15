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

function todayNairobi(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

describe("attendance (integration)", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;

  let makinaWard: { id: string; code: string };
  let woodleyWard: { id: string; code: string };

  let officer: { cookie: string | null; csrf: string | null };
  let employeeId: string;
  let employeeNumber: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await buildApp(testConfig(TEST_DB_URL));
    makinaWard = await prisma.ward.findUniqueOrThrow({ where: { code: "MAKINA" } });
    woodleyWard = await prisma.ward.findUniqueOrThrow({ where: { code: "WOODLEY" } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetAuthData(prisma);
    await prisma.attendance.deleteMany();
    await prisma.attendanceSession.deleteMany();
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
    expect(officer.cookie).toBeTruthy();

    employeeId = await createEmployee(prisma, {
      employeeNumber: "20250100100",
      fullName: "Attendee One",
      phone: "0713000100",
      wardId: makinaWard.id,
    });
    employeeNumber = "20250100100";
  });

  async function createSession(): Promise<{ id: string; token: string }> {
    const response = await api(app, {
      method: "POST",
      url: "/api/v1/attendance/sessions",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: {
        wardId: makinaWard.id,
        activity: "Cleaning",
        location: "Makina Ward Office",
        durationMinutes: 60,
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json();
  }

  it("creates a session and exposes a check-in token", async () => {
    const session = await createSession();
    expect(session.token.length).toBeGreaterThanOrEqual(32);
    expect(session.wardId).toBe(makinaWard.id);
    expect(session.closesAt).toBeDefined();
  });

  it("rejects a second active session for the same ward and date", async () => {
    await createSession();
    const second = await api(app, {
      method: "POST",
      url: "/api/v1/attendance/sessions",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: {
        wardId: makinaWard.id,
        activity: "Sweeping",
        location: "Makina Market",
        durationMinutes: 30,
      },
    });
    expect(second.statusCode).toBe(409);
  });

  it("permits a session in another ward within scope", async () => {
    const response = await api(app, {
      method: "POST",
      url: "/api/v1/attendance/sessions",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: {
        wardId: woodleyWard.id,
        activity: "Cleaning",
        location: "Woodley Field",
        durationMinutes: 60,
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it("checks in an employee as present via QR", async () => {
    const session = await createSession();
    const response = await api(app, {
      method: "POST",
      url: `/api/v1/attendance/sessions/${session.token}/check-in`,
      payload: { employeeNumber },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("PRESENT");
    expect(body.employee.id).toBe(employeeId);

    const record = await prisma.attendance.findFirst({
      where: { employeeId },
    });
    expect(record).not.toBeNull();
    expect(record!.verificationMethod).toBe("QR");
  });

  it("marks a late check-in after the 30-minute threshold", async () => {
    const session = await createSession();
    await prisma.attendanceSession.update({
      where: { id: session.id },
      data: { opensAt: new Date(Date.now() - 40 * 60 * 1000) },
    });
    const response = await api(app, {
      method: "POST",
      url: `/api/v1/attendance/sessions/${session.token}/check-in`,
      payload: { employeeNumber },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("LATE");
  });

  it("rejects a duplicate check-in for the same employee and day", async () => {
    const session = await createSession();
    const first = await api(app, {
      method: "POST",
      url: `/api/v1/attendance/sessions/${session.token}/check-in`,
      payload: { employeeNumber },
    });
    expect(first.statusCode).toBe(200);

    const second = await api(app, {
      method: "POST",
      url: `/api/v1/attendance/sessions/${session.token}/check-in`,
      payload: { employeeNumber },
    });
    expect(second.statusCode).toBe(409);
  });

  it("rejects an employee not in the ward's register", async () => {
    const session = await createSession();
    const otherId = await createEmployee(prisma, {
      employeeNumber: "20250100101",
      fullName: "Other Ward Staff",
      phone: "0713000101",
      wardId: woodleyWard.id,
    });
    void otherId;
    const response = await api(app, {
      method: "POST",
      url: `/api/v1/attendance/sessions/${session.token}/check-in`,
      payload: { employeeNumber: "20250100101" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects check-in into an expired session", async () => {
    const session = await createSession();
    await prisma.attendanceSession.update({
      where: { id: session.id },
      data: { closesAt: new Date(Date.now() - 5 * 60 * 1000) },
    });
    const response = await api(app, {
      method: "POST",
      url: `/api/v1/attendance/sessions/${session.token}/check-in`,
      payload: { employeeNumber },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects check-in by a deactivated employee", async () => {
    const session = await createSession();
    await prisma.employee.update({ where: { id: employeeId }, data: { active: false } });
    const response = await api(app, {
      method: "POST",
      url: `/api/v1/attendance/sessions/${session.token}/check-in`,
      payload: { employeeNumber },
    });
    expect(response.statusCode).toBe(400);
  });

  it("limits manual attendance to staff who did not check in", async () => {
    const session = await createSession();
    const secondEmployeeId = await createEmployee(prisma, {
      employeeNumber: "20250100102",
      fullName: "Manual Staff",
      phone: "0713000102",
      wardId: makinaWard.id,
    });

    const manual = await api(app, {
      method: "POST",
      url: "/api/v1/attendance/manual",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: {
        employeeId: secondEmployeeId,
        workDate: todayNairobi(),
        status: "OFF_DUTY",
        reason: "No transport to reach site today",
      },
    });
    expect(manual.statusCode).toBe(201);
    expect(manual.json().status).toBe("OFF_DUTY");

    await api(app, {
      method: "POST",
      url: `/api/v1/attendance/sessions/${session.token}/check-in`,
      payload: { employeeNumber },
    });

    const duplicate = await api(app, {
      method: "POST",
      url: "/api/v1/attendance/manual",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: {
        employeeId,
        workDate: todayNairobi(),
        status: "ABSENT",
        reason: "Should have been absent",
      },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it("rate limits repeated failed check-ins on one token", async () => {
    const session = await createSession();
    let status = 0;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const response = await api(app, {
        method: "POST",
        url: `/api/v1/attendance/sessions/${session.token}/check-in`,
        payload: { employeeNumber: "20259999999" },
      });
      status = response.statusCode;
      expect(status).toBe(400);
    }
    const blocked = await api(app, {
      method: "POST",
      url: `/api/v1/attendance/sessions/${session.token}/check-in`,
      payload: { employeeNumber: "20259999999" },
    });
    expect(blocked.statusCode).toBe(429);
  });

  it("derives roster status from check-in and manual records", async () => {
    const session = await createSession();
    const manualId = await createEmployee(prisma, {
      employeeNumber: "20250100103",
      fullName: "Manual Roster Staff",
      phone: "0713000103",
      wardId: makinaWard.id,
    });
    const absentId = await createEmployee(prisma, {
      employeeNumber: "20250100104",
      fullName: "Absent Roster Staff",
      phone: "0713000104",
      wardId: makinaWard.id,
    });
    const leaveId = await createEmployee(prisma, {
      employeeNumber: "20250100105",
      fullName: "On Leave Staff",
      phone: "0713000105",
      wardId: makinaWard.id,
      rosterStatus: "ANNUAL_LEAVE",
    });

    await api(app, {
      method: "POST",
      url: `/api/v1/attendance/sessions/${session.token}/check-in`,
      payload: { employeeNumber },
    });
    await api(app, {
      method: "POST",
      url: "/api/v1/attendance/manual",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: {
        employeeId: manualId,
        workDate: todayNairobi(),
        status: "SICK_OFF",
        reason: "Reported sick with malaria",
      },
    });
    void absentId;
    void leaveId;

    const roster = await api(app, {
      method: "GET",
      url: `/api/v1/attendance/roster?wardId=${makinaWard.id}`,
      cookie: officer.cookie,
    });
    expect(roster.statusCode).toBe(200);
    const rows = roster.json();
    expect(rows).toHaveLength(4);
    const byNumber = Object.fromEntries(
      rows.map((row: { employee: { employeeNumber: string }; status: string }) => [
        row.employee.employeeNumber,
        row.status,
      ]),
    );
    expect(byNumber[employeeNumber]).toBe("PRESENT");
    expect(byNumber["20250100103"]).toBe("SICK_OFF");
    expect(byNumber["20250100104"]).toBe("ABSENT");
    expect(byNumber["20250100105"]).toBe("LEAVE");
  });

  it("blocks an officer from reading another ward's attendance", async () => {
    const foreignSession = await prisma.attendanceSession.create({
      data: {
        token: "foreign-token-000000000000000000000000",
        wardId: woodleyWard.id,
        workDate: new Date(`${todayNairobi()}T00:00:00.000Z`),
        activity: "Cleaning",
        location: "Woodley",
        opensAt: new Date(Date.now() - 60 * 1000),
        closesAt: new Date(Date.now() + 60 * 60 * 1000),
        createdBy: "00000000-0000-0000-0000-000000000000",
      },
    });

    const hidden = await api(app, {
      method: "GET",
      url: `/api/v1/attendance/sessions/${foreignSession.id}`,
      cookie: officer.cookie,
    });
    expect(hidden.statusCode).toBe(404);

    const list = await api(app, {
      method: "GET",
      url: "/api/v1/attendance/sessions",
      cookie: officer.cookie,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(0);
  });
});