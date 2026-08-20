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

const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

function todayNairobi(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

describe("evidence (integration)", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;

  let makinaWard: { id: string; code: string };
  let woodleyWard: { id: string; code: string };

  let officer: { cookie: string | null; csrf: string | null };
  let viewer: { cookie: string | null; csrf: string | null };
  let foreignOfficer: { cookie: string | null; csrf: string | null };

  let workLogId: string;
  let foreignWorkLogId: string;

  async function createWorkLogRow(wardId: string, submittedBy: string): Promise<string> {
    const row = await prisma.workLog.create({
      data: {
        wardId,
        workDate: new Date(`${todayNairobi()}T00:00:00.000Z`),
        activity: "Drainage desilting",
        location: "Makina Market area",
        description: "Desilted open drains",
        staffCount: 5,
        status: "DRAFT",
        submittedBy,
        detail: { create: { completionStatus: "COMPLETE", outstandingWork: null } },
        operations: {
          create: {
            areasRoads: "Moktar Daddah Road",
            numberOfTrips: 0,
            wasteTransferInvolved: false,
            truckId: null,
            backhoeId: null,
            cleanupDone: false,
            cleanupStakeholders: null,
            climateTeamCount: 0,
          },
        },
      },
    });
    return row.id;
  }

  async function uploadPhoto(
    logId: string,
    session: { cookie: string | null; csrf: string | null } = officer,
    stage = "BEFORE",
    data: Buffer = TINY_JPEG,
  ): Promise<{ status: number; body: unknown }> {
    const upload = multipart({ workLogId: logId, stage }, { name: "photo.jpg", data });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: {
        cookie: session.cookie!,
        "x-csrf-token": session.csrf!,
        "content-type": upload.contentType,
      },
      payload: upload.body,
    });
    return { status: response.statusCode, body: response.json() };
  }

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
    await prisma.evidence.deleteMany();
    await prisma.workLog.deleteMany();

    const officerId = await createUserWithAssignment(prisma, {
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
      scopeId: (await prisma.subcounty.findUniqueOrThrow({ where: { code: "KIBRA" } })).id,
    });
    viewer = await login(app, "reviewer@makina.test", PASSWORD);

    const foreignOfficerId = await createUserWithAssignment(prisma, {
      email: "foreign@woodley.test",
      password: PASSWORD,
      displayName: "Woodley Officer",
      roleCode: "WARD_OFFICER",
      scopeType: "WARD",
      scopeId: woodleyWard.id,
    });
    foreignOfficer = await login(app, "foreign@woodley.test", PASSWORD);

    workLogId = await createWorkLogRow(makinaWard.id, officerId);
    foreignWorkLogId = await createWorkLogRow(woodleyWard.id, foreignOfficerId);
  });

  it("uploads evidence and exposes it in the work log list", async () => {
    const { status, body } = await uploadPhoto(workLogId, officer, "BEFORE");
    expect(status).toBe(201);
    const evidence = body as Record<string, any>;
    expect(evidence.stage).toBe("BEFORE");
    expect(evidence.contentType).toBe("image/jpeg");
    expect(evidence.workLogId).toBe(workLogId);
    expect(evidence.sha256).toMatch(/^[0-9a-f]{64}$/);

    const list = await api(app, {
      method: "GET",
      url: `/api/v1/evidence?workLogId=${workLogId}`,
      cookie: officer.cookie,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
  });

  it("enforces the before/during/after stage limit", async () => {
    for (let i = 0; i < 4; i += 1) {
      const { status } = await uploadPhoto(workLogId, officer, "DURING");
      expect(status).toBe(201);
    }
    const { status } = await uploadPhoto(workLogId, officer, "DURING");
    expect(status).toBe(400);
  });

  it("prohibits evidence mutation after terminal review", async () => {
    const initial = await uploadPhoto(workLogId, officer, "BEFORE");
    expect(initial.status).toBe(201);
    const submitted = await api(app, {
      method: "POST",
      url: `/api/v1/work-logs/${workLogId}/actions`,
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: { action: "SUBMIT", expectedVersion: 1 },
    });
    expect(submitted.statusCode).toBe(201);
    const approved = await api(app, {
      method: "POST",
      url: `/api/v1/work-logs/${workLogId}/actions`,
      cookie: viewer.cookie,
      csrf: viewer.csrf,
      payload: { action: "APPROVE", expectedVersion: 2 },
    });
    expect(approved.statusCode).toBe(201);
    const upload = await uploadPhoto(workLogId, officer, "AFTER");
    expect(upload.status).toBe(409);
  });

  it("rejects a non-image upload", async () => {
    const { status } = await uploadPhoto(workLogId, officer, "BEFORE", Buffer.from("not a photo"));
    expect(status).toBe(400);
  });

  it("streams downloaded evidence back to an authorized reader", async () => {
    const { body } = await uploadPhoto(workLogId, officer, "AFTER");
    const id = (body as Record<string, any>).id;
    const submitted = await api(app, {
      method: "POST",
      url: `/api/v1/work-logs/${workLogId}/actions`,
      cookie: officer.cookie,
      csrf: officer.csrf,
      payload: { action: "SUBMIT", expectedVersion: 1 },
    });
    expect(submitted.statusCode).toBe(201);

    const download = await api(app, {
      method: "GET",
      url: `/api/v1/evidence/${id}/download`,
      cookie: viewer.cookie,
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("image/jpeg");
  });

  it("keeps draft evidence private to the submitting officer", async () => {
    const { status, body } = await uploadPhoto(workLogId, officer, "BEFORE");
    expect(status).toBe(201);
    const evidenceId = (body as Record<string, any>).id;

    const list = await api(app, {
      method: "GET",
      url: `/api/v1/evidence?workLogId=${workLogId}`,
      cookie: viewer.cookie,
    });
    expect(list.statusCode).toBe(404);

    const download = await api(app, {
      method: "GET",
      url: `/api/v1/evidence/${evidenceId}/download`,
      cookie: viewer.cookie,
    });
    expect(download.statusCode).toBe(404);
  });

  it("requires WORK_CREATE to upload and WORK_READ to view", async () => {
    await createUserWithAssignment(prisma, {
      email: "readonly@makina.test",
      password: PASSWORD,
      displayName: "Read Only",
      roleCode: "READ_ONLY",
      scopeType: "COUNTY",
      scopeId: (await prisma.county.findUniqueOrThrow({ where: { code: "NCC" } })).id,
    });
    const readOnly = await login(app, "readonly@makina.test", PASSWORD);

    const uploaded = await uploadPhoto(workLogId, readOnly);
    expect(uploaded.status).toBe(403);

    const list = await api(app, {
      method: "GET",
      url: `/api/v1/evidence?workLogId=${workLogId}`,
      cookie: readOnly.cookie,
    });
    expect(list.statusCode).toBe(403);
  });

  it("does not expose evidence outside the viewer's ward scope", async () => {
    const { status, body } = await uploadPhoto(workLogId, officer, "BEFORE");
    expect(status).toBe(201);
    const evidenceId = (body as Record<string, any>).id;

    const list = await api(app, {
      method: "GET",
      url: `/api/v1/evidence?workLogId=${workLogId}`,
      cookie: foreignOfficer.cookie,
    });
    expect(list.statusCode).toBe(404);

    const download = await api(app, {
      method: "GET",
      url: `/api/v1/evidence/${evidenceId}/download`,
      cookie: foreignOfficer.cookie,
    });
    expect(download.statusCode).toBe(404);

    const upload = await uploadPhoto(foreignWorkLogId, officer);
    expect(upload.status).toBe(404);
  });

  it("regression: DB metadata surviving a missing object is detected (§24)", async () => {
    const { status } = await uploadPhoto(workLogId, officer, "BEFORE");
    expect(status).toBe(201);
    // objectKey is intentionally never exposed over the API; read it from the
    // database to simulate the lost-object scenario.
    const row = await prisma.evidence.findFirstOrThrow({ where: { workLogId } });

    // Delete the stored object directly, simulating a lost container volume
    // while the database metadata survives — the legacy "broken photo" failure.
    const { readdir, unlink } = await import("node:fs/promises");
    const path = await import("node:path");
    const files = await readdir(path.resolve("data/documents"));
    const objectFile = files.find((name) => name === row.objectKey);
    expect(objectFile).toBeTruthy();
    await unlink(path.join(path.resolve("data/documents"), objectFile!));

    const download = await api(app, {
      method: "GET",
      url: `/api/v1/evidence/${row.id}/download`,
      cookie: officer.cookie,
    });
    expect(download.statusCode).toBe(404);
  });

  it("regression: a corrupted stored object fails the sha256 integrity check", async () => {
    const { status } = await uploadPhoto(workLogId, officer, "BEFORE");
    expect(status).toBe(201);
    const row = await prisma.evidence.findFirstOrThrow({ where: { workLogId } });

    const path = await import("node:path");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      path.join(path.resolve("data/documents"), row.objectKey),
      Buffer.from("corrupted bytes"),
    );

    const download = await api(app, {
      method: "GET",
      url: `/api/v1/evidence/${row.id}/download`,
      cookie: officer.cookie,
    });
    expect(download.statusCode).toBe(404);
  });
});
