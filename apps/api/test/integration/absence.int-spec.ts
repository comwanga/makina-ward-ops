import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { AbsenceReminderService } from "../../dist/absence/absence-reminder.service";
import { ABSENCE_REMINDER_SERVICE } from "../../dist/absence/absence.module";

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

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function multipart(
  fields: Record<string, string>,
  file: { name: string; data: Buffer },
): { body: Buffer; contentType: string } {
  const boundary = `----wardops${Math.random().toString(36).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
  );
  chunks.push(file.data);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("absence management (integration)", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;

  let makinaWard: { id: string; code: string };
  let woodleyWard: { id: string; code: string };
  let kibraSubcounty: { id: string };

  let officer: { cookie: string | null; csrf: string | null };
  let reviewer: { cookie: string | null; csrf: string | null };
  let hr: { cookie: string | null; csrf: string | null };

  let employeeId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await buildApp(testConfig(TEST_DB_URL));
    makinaWard = await prisma.ward.findUniqueOrThrow({ where: { code: "MAKINA" } });
    woodleyWard = await prisma.ward.findUniqueOrThrow({ where: { code: "WOODLEY" } });
    kibraSubcounty = await prisma.subcounty.findUniqueOrThrow({
      where: { code: "KIBRA" },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetAuthData(prisma);
    await prisma.reminderDelivery.deleteMany();
    await prisma.documentClassification.deleteMany();
    await prisma.document.deleteMany();
    await prisma.absenceRequest.deleteMany();
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

    await createUserWithAssignment(prisma, {
      email: "reviewer@makina.test",
      password: PASSWORD,
      displayName: "Subcounty Reviewer",
      roleCode: "SUBCOUNTY_REVIEWER",
      scopeType: "SUBCOUNTY",
      scopeId: kibraSubcounty.id,
    });
    reviewer = await login(app, "reviewer@makina.test", PASSWORD);

    await createUserWithAssignment(prisma, {
      email: "hr@makina.test",
      password: PASSWORD,
      displayName: "HR Viewer",
      roleCode: "HR_VIEWER",
      scopeType: "COUNTY",
      scopeId: (await prisma.county.findUniqueOrThrow({ where: { code: "NCC" } })).id,
    });
    hr = await login(app, "hr@makina.test", PASSWORD);

    employeeId = await createEmployee(prisma, {
      employeeNumber: "20250100200",
      fullName: "Absence Staff",
      phone: "0714000200",
      wardId: makinaWard.id,
    });
  });

  async function createAbsence(payload: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
    const response = await api(app, {
      method: "POST",
      url: "/api/v1/absence-requests",
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload,
    });
    return { status: response.statusCode, body: response.json() };
  }

  async function action(
    id: string,
    payload: Record<string, unknown>,
    session: { cookie: string | null; csrf: string | null } = officer,
  ): Promise<{ status: number; body: unknown }> {
    const response = await api(app, {
      method: "POST",
      url: `/api/v1/absence-requests/${id}/actions`,
      cookie: session.cookie,
      csrf: session.csrf,
      payload: { expectedVersion: 1, ...payload },
    });
    return { status: response.statusCode, body: response.json() };
  }

  it("creates a submitted absence request", async () => {
    const { status, body } = await createAbsence({
      employeeId,
      kind: "ANNUAL_LEAVE",
      startDate: todayNairobi(),
      endDate: addDays(todayNairobi(), 3),
      returnDate: addDays(todayNairobi(), 4),
      reason: "Family event",
    });
    expect(status).toBe(201);
    const absence = body as Record<string, any>;
    expect(absence.status).toBe("SUBMITTED");
    expect(absence.employee.id).toBe(employeeId);
    expect(absence.documents).toEqual([]);
  });

  it("creates a planned (draft) request", async () => {
    const { status, body } = await createAbsence({
      employeeId,
      kind: "ANNUAL_LEAVE",
      startDate: addDays(todayNairobi(), 20),
      endDate: addDays(todayNairobi(), 24),
      returnDate: addDays(todayNairobi(), 25),
      reason: "Planned leave",
      planned: true,
    });
    expect(status).toBe(201);
    expect((body as Record<string, any>).status).toBe("PLANNED");
  });

  it("rejects an overlapping submitted request", async () => {
    await createAbsence({
      employeeId,
      kind: "ANNUAL_LEAVE",
      startDate: todayNairobi(),
      endDate: addDays(todayNairobi(), 3),
      returnDate: addDays(todayNairobi(), 4),
      reason: "First leave",
    });
    const { status } = await createAbsence({
      employeeId,
      kind: "SICK_OFF",
      startDate: addDays(todayNairobi(), 2),
      endDate: addDays(todayNairobi(), 5),
      returnDate: addDays(todayNairobi(), 6),
      reason: "Overlapping sick leave request here",
    });
    expect(status).toBe(409);
  });

  it("requires a sufficient sick-off reason", async () => {
    const { status } = await createAbsence({
      employeeId,
      kind: "SICK_OFF",
      startDate: todayNairobi(),
      endDate: todayNairobi(),
      returnDate: addDays(todayNairobi(), 1),
      reason: "Short",
    });
    expect(status).toBe(422);
  });

  it("enforces the state machine: approve on PLANNED is rejected", async () => {
    const { body } = await createAbsence({
      employeeId,
      kind: "ANNUAL_LEAVE",
      startDate: addDays(todayNairobi(), 20),
      endDate: addDays(todayNairobi(), 24),
      returnDate: addDays(todayNairobi(), 25),
      reason: "Planned",
      planned: true,
    });
    const id = (body as Record<string, any>).id;
    const { status } = await action(id, { action: "APPROVE" }, reviewer);
    expect(status).toBe(409);
  });

  it("rejects without a review note", async () => {
    const { body } = await createAbsence({
      employeeId,
      kind: "ANNUAL_LEAVE",
      startDate: todayNairobi(),
      endDate: addDays(todayNairobi(), 1),
      returnDate: addDays(todayNairobi(), 2),
      reason: "Leave request",
    });
    const id = (body as Record<string, any>).id;
    const { status } = await action(id, { action: "REJECT" }, reviewer);
    expect(status).toBe(400);
  });

  it("lets a subcounty reviewer approve a submitted request", async () => {
    const { body } = await createAbsence({
      employeeId,
      kind: "ANNUAL_LEAVE",
      startDate: addDays(todayNairobi(), 10),
      endDate: addDays(todayNairobi(), 14),
      returnDate: addDays(todayNairobi(), 15),
      reason: "Leave request",
    });
    const id = (body as Record<string, any>).id;
    const { status, body: result } = await action(id, { action: "APPROVE" }, reviewer);
    expect(status).toBe(201);
    expect((result as Record<string, any>).status).toBe("APPROVED");
    expect((result as Record<string, any>).reviewedBy).toBeTruthy();
  });

  it("rejects a stale absence transition version", async () => {
    const { body } = await createAbsence({
      employeeId,
      kind: "ANNUAL_LEAVE",
      startDate: addDays(todayNairobi(), 10),
      endDate: addDays(todayNairobi(), 11),
      returnDate: addDays(todayNairobi(), 12),
      reason: "Versioned leave request",
    });
    const id = (body as Record<string, any>).id;
    const stale = await action(id, { action: "APPROVE", expectedVersion: 2 }, reviewer);
    expect(stale.status).toBe(409);
    expect((await prisma.absenceRequest.findUniqueOrThrow({ where: { id } })).status).toBe("SUBMITTED");
  });

  it("rejects a submitted request with a note", async () => {
    const { body } = await createAbsence({
      employeeId,
      kind: "ANNUAL_LEAVE",
      startDate: todayNairobi(),
      endDate: addDays(todayNairobi(), 1),
      returnDate: addDays(todayNairobi(), 2),
      reason: "Leave request",
    });
    const id = (body as Record<string, any>).id;
    const { status, body: result } = await action(
      id,
      { action: "REJECT", reviewNote: "Coverage unavailable" },
      reviewer,
    );
    expect(status).toBe(201);
    expect((result as Record<string, any>).status).toBe("REJECTED");
    expect((result as Record<string, any>).reviewNote).toBe("Coverage unavailable");
  });

  it("forbids a ward officer from approving (no ABSENCE_REVIEW)", async () => {
    const { body } = await createAbsence({
      employeeId,
      kind: "ANNUAL_LEAVE",
      startDate: todayNairobi(),
      endDate: addDays(todayNairobi(), 1),
      returnDate: addDays(todayNairobi(), 2),
      reason: "Leave request",
    });
    const id = (body as Record<string, any>).id;
    const { status } = await action(id, { action: "APPROVE" });
    expect(status).toBe(403);
  });

  it("allows the officer to cancel their own submitted request", async () => {
    const { body } = await createAbsence({
      employeeId,
      kind: "ANNUAL_LEAVE",
      startDate: todayNairobi(),
      endDate: addDays(todayNairobi(), 1),
      returnDate: addDays(todayNairobi(), 2),
      reason: "Leave request",
    });
    const id = (body as Record<string, any>).id;
    const { status, body: result } = await action(id, { action: "CANCEL" });
    expect(status).toBe(201);
    expect((result as Record<string, any>).status).toBe("CANCELLED");
  });

  it("keeps absences scoped to the requesting user's wards", async () => {
    await createAbsence({
      employeeId,
      kind: "ANNUAL_LEAVE",
      startDate: todayNairobi(),
      endDate: addDays(todayNairobi(), 1),
      returnDate: addDays(todayNairobi(), 2),
      reason: "Makina leave",
    });
    const foreignEmployee = await createEmployee(prisma, {
      employeeNumber: "20250100201",
      fullName: "Woodley Staff",
      phone: "0714000201",
      wardId: woodleyWard.id,
    });
    await prisma.absenceRequest.create({
      data: {
        employeeId: foreignEmployee,
        wardId: woodleyWard.id,
        kind: "ANNUAL_LEAVE",
        startDate: new Date(`${todayNairobi()}T00:00:00.000Z`),
        endDate: new Date(`${addDays(todayNairobi(), 1)}T00:00:00.000Z`),
        returnDate: new Date(`${addDays(todayNairobi(), 2)}T00:00:00.000Z`),
        reason: "Woodley leave",
        status: "SUBMITTED",
        submittedBy: "test",
      },
    });

    const list = await api(app, {
      method: "GET",
      url: "/api/v1/absence-requests",
      cookie: officer.cookie,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
  });

  it("does not expose another ward's absence by id or action", async () => {
    const foreignEmployee = await createEmployee(prisma, {
      employeeNumber: "20250100202",
      fullName: "Woodley Staff Two",
      phone: "0714000202",
      wardId: woodleyWard.id,
    });
    const foreign = await prisma.absenceRequest.create({
      data: {
        employeeId: foreignEmployee,
        wardId: woodleyWard.id,
        kind: "ANNUAL_LEAVE",
        startDate: new Date(`${todayNairobi()}T00:00:00.000Z`),
        endDate: new Date(`${addDays(todayNairobi(), 1)}T00:00:00.000Z`),
        returnDate: new Date(`${addDays(todayNairobi(), 2)}T00:00:00.000Z`),
        reason: "Woodley leave",
        status: "SUBMITTED",
        submittedBy: "test",
      },
    });
    const hidden = await api(app, {
      method: "GET",
      url: `/api/v1/absence-requests/${foreign.id}`,
      cookie: officer.cookie,
    });
    expect(hidden.statusCode).toBe(404);

    const acted = await action(foreign.id, { action: "CANCEL" });
    expect(acted.status).toBe(404);
  });

  it("derives roster status from approved absences", async () => {
    const leaveEmployee = await createEmployee(prisma, {
      employeeNumber: "20250100203",
      fullName: "On Leave",
      phone: "0714000203",
      wardId: makinaWard.id,
    });
    const sickEmployee = await createEmployee(prisma, {
      employeeNumber: "20250100204",
      fullName: "On Sick Off",
      phone: "0714000204",
      wardId: makinaWard.id,
    });
    const dutyEmployee = await createEmployee(prisma, {
      employeeNumber: "20250100205",
      fullName: "Official Duty",
      phone: "0714000205",
      wardId: makinaWard.id,
    });
    const todayDate = new Date(`${todayNairobi()}T00:00:00.000Z`);
    for (const [employee, kind] of [
      [leaveEmployee, "ANNUAL_LEAVE"],
      [sickEmployee, "SICK_OFF"],
      [dutyEmployee, "OFFICIAL_DUTY"],
    ] as const) {
      await prisma.absenceRequest.create({
        data: {
          employeeId: employee,
          wardId: makinaWard.id,
          kind,
          startDate: todayDate,
          endDate: todayDate,
          returnDate: new Date(`${addDays(todayNairobi(), 2)}T00:00:00.000Z`),
          reason: "Approved absence",
          status: "APPROVED",
          submittedBy: "test",
          reviewedBy: "reviewer",
          reviewedAt: new Date(),
        },
      });
    }

    const roster = await api(app, {
      method: "GET",
      url: `/api/v1/attendance/roster?wardId=${makinaWard.id}`,
      cookie: officer.cookie,
    });
    expect(roster.statusCode).toBe(200);
    const rows = roster.json() as Array<{ employee: { employeeNumber: string }; status: string }>;
    const byNumber = Object.fromEntries(rows.map((row) => [row.employee.employeeNumber, row.status]));
    expect(byNumber["20250100203"]).toBe("LEAVE");
    expect(byNumber["20250100204"]).toBe("SICK_OFF");
    expect(byNumber["20250100205"]).toBe("OFFICIAL_DUTY");
  });

  it("uploads and authorizes absence documents", async () => {
    const { body } = await createAbsence({
      employeeId,
      kind: "SICK_OFF",
      startDate: todayNairobi(),
      endDate: todayNairobi(),
      returnDate: addDays(todayNairobi(), 1),
      reason: "Reported sick with malaria",
    });
    const absenceId = (body as Record<string, any>).id;

    const invalid = multipart({ documentCategory: "SICK_SHEET" }, {
      name: "not-a-doc.txt",
      data: Buffer.from("this is not a real document"),
    });
    const invalidUpload = await app.inject({
      method: "POST",
      url: `/api/v1/absence-requests/${absenceId}/documents`,
      headers: {
        cookie: officer.cookie!,
        "x-csrf-token": officer.csrf!,
        "content-type": invalid.contentType,
      },
      payload: invalid.body,
    });
    expect(invalidUpload.statusCode).toBe(400);

    const upload = multipart({ documentCategory: "SICK_SHEET" }, {
      name: "sick-sheet.pdf",
      data: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"),
    });
    const uploaded = await app.inject({
      method: "POST",
      url: `/api/v1/absence-requests/${absenceId}/documents`,
      headers: {
        cookie: officer.cookie!,
        "x-csrf-token": officer.csrf!,
        "content-type": upload.contentType,
      },
      payload: upload.body,
    });
    expect(uploaded.statusCode).toBe(201);
    const document = uploaded.json() as Record<string, any>;
    expect(document.contentType).toBe("application/pdf");
    expect(document.category).toBe("SICK_SHEET");

    const downloaded = await api(app, {
      method: "GET",
      url: `/api/v1/absence-requests/documents/${document.id}/download`,
      cookie: hr.cookie,
    });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.body).toContain("%PDF");

    const restricted = await api(app, {
      method: "GET",
      url: `/api/v1/absence-requests/documents/${document.id}/download`,
      cookie: officer.cookie,
    });
    expect(restricted.statusCode).toBe(403);
  });

  it("regression: document download detects a missing stored object (read integrity)", async () => {
    const { body } = await createAbsence({
      employeeId,
      kind: "SICK_OFF",
      startDate: todayNairobi(),
      endDate: todayNairobi(),
      returnDate: addDays(todayNairobi(), 1),
      reason: "Reported sick with malaria",
    });
    const absenceId = (body as Record<string, any>).id;

    const upload = multipart({ documentCategory: "SICK_SHEET" }, {
      name: "sick-sheet.pdf",
      data: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"),
    });
    const uploaded = await app.inject({
      method: "POST",
      url: `/api/v1/absence-requests/${absenceId}/documents`,
      headers: {
        cookie: officer.cookie!,
        "x-csrf-token": officer.csrf!,
        "content-type": upload.contentType,
      },
      payload: upload.body,
    });
    expect(uploaded.statusCode).toBe(201);

    // objectKey is intentionally not exposed over the API; read it from the
    // database to simulate the lost-object scenario (§24).
    const row = await prisma.document.findFirstOrThrow({
      where: { absenceRequestId: absenceId },
    });
    const { unlink } = await import("node:fs/promises");
    const path = await import("node:path");
    const objectPath = path.join(path.resolve("data/documents"), row.objectKey);
    await unlink(objectPath);

    const download = await api(app, {
      method: "GET",
      url: `/api/v1/absence-requests/documents/${row.id}/download`,
      cookie: hr.cookie,
    });
    expect(download.statusCode).toBe(404);
  });

  it("regression: document download rejects a corrupted stored object (sha256 check)", async () => {
    const { body } = await createAbsence({
      employeeId,
      kind: "SICK_OFF",
      startDate: todayNairobi(),
      endDate: todayNairobi(),
      returnDate: addDays(todayNairobi(), 1),
      reason: "Reported sick with malaria",
    });
    const absenceId = (body as Record<string, any>).id;

    const upload = multipart({ documentCategory: "SICK_SHEET" }, {
      name: "sick-sheet.pdf",
      data: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"),
    });
    const uploaded = await app.inject({
      method: "POST",
      url: `/api/v1/absence-requests/${absenceId}/documents`,
      headers: {
        cookie: officer.cookie!,
        "x-csrf-token": officer.csrf!,
        "content-type": upload.contentType,
      },
      payload: upload.body,
    });
    expect(uploaded.statusCode).toBe(201);

    const row = await prisma.document.findFirstOrThrow({
      where: { absenceRequestId: absenceId },
    });
    const path = await import("node:path");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      path.join(path.resolve("data/documents"), row.objectKey),
      Buffer.from("corrupted bytes"),
    );

    const download = await api(app, {
      method: "GET",
      url: `/api/v1/absence-requests/documents/${row.id}/download`,
      cookie: hr.cookie,
    });
    expect(download.statusCode).toBe(404);
  });

  it("queues idempotent leave reminders at 30/14/7 days", async () => {
    const employee = await prisma.employee.update({
      where: { id: employeeId },
      data: { email: "absentee@makina.test" },
    });
    void employee;
    const start = addDays(todayNairobi(), 7);
    const created = await prisma.absenceRequest.create({
      data: {
        employeeId,
        wardId: makinaWard.id,
        kind: "ANNUAL_LEAVE",
        startDate: new Date(`${start}T00:00:00.000Z`),
        endDate: new Date(`${addDays(start, 2)}T00:00:00.000Z`),
        returnDate: new Date(`${addDays(start, 3)}T00:00:00.000Z`),
        reason: "Reminder leave",
        status: "SUBMITTED",
        submittedBy: "test",
      },
    });

    const reminders = app.get<AbsenceReminderService>(ABSENCE_REMINDER_SERVICE, {
      strict: false,
    });
    const first = await reminders.processReminders();
    (reminders as unknown as { transporter: { sendMail: ReturnType<typeof vi.fn> } }).transporter = {
      sendMail: vi.fn().mockResolvedValue({ messageId: "sent" }),
    };
    const second = await reminders.processReminders();
    const auditCount = await prisma.auditEvent.count({ where: { action: "ABSENCE.REMINDERS_PROCESSED" } });
    const third = await reminders.processReminders();

    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(third).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "ABSENCE.REMINDERS_PROCESSED" } })).toBe(auditCount);

    const deliveries = await prisma.reminderDelivery.findMany({
      where: { absenceRequestId: created.id },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].reminderDays).toBe(7);
    expect(deliveries[0].recipient).toBe("absentee@makina.test");
    expect(deliveries[0].status).toBe("SENT");
  });
});
