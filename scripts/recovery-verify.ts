import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "../packages/database/dist/index.js";

/**
 * Verifies a recovery drill restore: the synthetic dataset (user, employee,
 * attendance, work log, evidence object and finalized report) must be present
 * and internally consistent. Exits non-zero on any mismatch.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "drill-officer@makina.example" },
      include: { assignments: true },
    });
    if (user.assignments.length !== 1) {
      throw new Error("Expected one assignment for the drill officer");
    }
    const roleCapabilities = await prisma.roleCapability.count();
    if (roleCapabilities === 0) {
      throw new Error("Expected seeded role capabilities after restore");
    }

    const employee = await prisma.employee.findUniqueOrThrow({
      where: { phone: "0799888777" },
    });
    const attendance = await prisma.attendance.count({
      where: { employeeId: employee.id },
    });
    if (attendance !== 1) {
      throw new Error(`Expected 1 attendance row, found ${attendance}`);
    }

    const workLog = await prisma.workLog.findFirstOrThrow({
      where: { activity: "Drain clearing" },
    });
    const evidence = await prisma.evidence.findFirstOrThrow({
      where: { workLogId: workLog.id },
    });

    const documentStoreDir = process.env.DOCUMENT_STORE_DIR ?? "data/objects";
    const stored = await readFile(path.join(documentStoreDir, evidence.objectKey));
    const expectedSha256 = createHash("sha256").update("recovery-drill-evidence").digest("hex");
    if (evidence.sha256 !== expectedSha256) {
      throw new Error("Evidence sha256 does not match the synthetic fixture");
    }
    if (createHash("sha256").update(stored).digest("hex") !== expectedSha256) {
      throw new Error("Restored evidence object bytes do not match");
    }

    const report = await prisma.report.findFirstOrThrow({
      where: { title: "Recovery drill daily report" },
    });
    if (report.status !== "FINALIZED") {
      throw new Error("Restored report is not finalized");
    }

    console.log(
      `Verified: user, employee, ${attendance} attendance, work log, evidence object (${stored.length} bytes), finalized report.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
