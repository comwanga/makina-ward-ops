import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "../packages/database/dist/index.js";

/**
 * Loads a small synthetic dataset for the recovery drill: an officer user,
 * a ward employee, an attendance session with a check-in, a work log with a
 * finalised report, and one evidence file written to the object-store volume.
 * Recovery verification asserts all of these survive a restore.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction([
      prisma.legacyMigration.deleteMany(),
      prisma.reportEvidence.deleteMany(),
      prisma.evidence.deleteMany(),
      prisma.report.deleteMany(),
      prisma.workLogOperations.deleteMany(),
      prisma.workLogDetail.deleteMany(),
      prisma.workLog.deleteMany(),
      prisma.attendance.deleteMany(),
      prisma.attendanceSession.deleteMany(),
      prisma.employeeAssignment.deleteMany(),
      prisma.employeeProfile.deleteMany(),
      prisma.employee.deleteMany(),
      prisma.assignment.deleteMany(),
      prisma.userCapability.deleteMany(),
      prisma.roleCapability.deleteMany(),
      prisma.userSession.deleteMany(),
      prisma.accessRequest.deleteMany(),
      prisma.auditEvent.deleteMany(),
      prisma.user.deleteMany(),
    ]);

    const role = await prisma.role.findUniqueOrThrow({ where: { code: "WARD_OFFICER" } });
    const ward = await prisma.ward.findUniqueOrThrow({ where: { code: "MAKINA" } });

    const user = await prisma.user.create({
      data: {
        email: "drill-officer@makina.example",
        displayName: "Recovery Drill Officer",
        passwordHash: "scrypt$drill-does-not-need-real-login",
        active: true,
        mustChangePassword: false,
        assignments: { create: { roleId: role.id, scopeType: "WARD", wardId: ward.id } },
      },
    });

    const employee = await prisma.employee.create({
      data: {
        employeeNumber: "20260466001",
        fullName: "Recovery Drill Worker",
        phone: "0799888777",
        designation: "Green Army Staff",
        active: true,
        wardId: ward.id,
        profile: { create: { residence: "Makina", rosterStatus: "ON_DUTY" } },
        assignments: { create: { wardId: ward.id } },
      },
    });

    const session = await prisma.attendanceSession.create({
      data: {
        token: "drill-session-token",
        wardId: ward.id,
        workDate: new Date("2026-08-17"),
        activity: "Recovery drill cleanup",
        location: "Makina",
        opensAt: new Date("2026-08-17T06:00:00Z"),
        closesAt: new Date("2026-08-17T14:00:00Z"),
        createdBy: user.id,
      },
    });
    await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        sessionId: session.id,
        wardId: ward.id,
        workDate: new Date("2026-08-17"),
        checkedAt: new Date("2026-08-17T06:05:00Z"),
        status: "PRESENT",
      },
    });

    const workLog = await prisma.workLog.create({
      data: {
        wardId: ward.id,
        workDate: new Date("2026-08-17"),
        activity: "Drain clearing",
        location: "Makina",
        description: "Synthetic recovery-drill work log",
        staffCount: 1,
        status: "APPROVED",
        submittedBy: user.id,
        reviewedBy: user.id,
        detail: { create: { completionStatus: "COMPLETE" } },
        operations: {
          create: {
            areasRoads: "Makina access roads",
            numberOfTrips: 1,
            wasteTransferInvolved: false,
            cleanupDone: true,
            climateTeamCount: 2,
          },
        },
      },
    });

    const documentStoreDir = process.env.DOCUMENT_STORE_DIR ?? "data/objects";
    const objectKey = createHash("sha256").update("recovery-drill-evidence").digest("hex").slice(0, 48);
    const content = Buffer.from("recovery-drill-evidence");
    await mkdir(documentStoreDir, { recursive: true });
    await writeFile(path.join(documentStoreDir, objectKey), content, { mode: 0o600 });

    await prisma.evidence.create({
      data: {
        workLogId: workLog.id,
        objectKey,
        stage: "AFTER",
        caption: "Recovery drill evidence",
        contentType: "image/jpeg",
        size: content.length,
        sha256: createHash("sha256").update(content).digest("hex"),
        uploadedBy: user.id,
      },
    });

    await prisma.report.create({
      data: {
        kind: "DAILY",
        scopeType: "WARD",
        scopeId: ward.id,
        periodStart: new Date("2026-08-17"),
        periodEnd: new Date("2026-08-17"),
        status: "FINALIZED",
        title: "Recovery drill daily report",
        narrative: "Synthetic report created by the recovery drill.",
        recommendations: "Verify restore coverage.",
        snapshot: { drill: true },
        version: 1,
        finalizedBy: user.id,
        finalizedAt: new Date(),
        createdBy: user.id,
      },
    });

    console.log("Synthetic data loaded.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});