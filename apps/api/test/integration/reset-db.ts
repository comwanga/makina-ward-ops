import { execSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@ward-ops/database";

const REPO_ROOT = path.resolve(process.cwd(), "../..");

/**
 * Rebuilds the test database: applies migrations, seeds reference data,
 * clears dynamic records and adds extra organisational scope (Mombasa
 * county, Langata subcounty + Woodley ward, Likoni) used by tenancy tests.
 */
export async function resetDatabase(databaseUrl: string): Promise<void> {
  process.env.DATABASE_URL = databaseUrl;
  execSync("pnpm --filter @ward-ops/database db:deploy", {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });

  const prisma = new PrismaClient();
  try {
    await prisma.$transaction([
      prisma.legacyMigration.deleteMany(),
      prisma.reportEvidence.deleteMany(),
      prisma.evidence.deleteMany(),
      prisma.report.deleteMany(),
      prisma.reminderDelivery.deleteMany(),
      prisma.workLogOperations.deleteMany(),
      prisma.workLogDetail.deleteMany(),
      prisma.workLog.deleteMany(),
      prisma.attendance.deleteMany(),
      prisma.attendanceSession.deleteMany(),
      prisma.absenceRequest.deleteMany(),
      prisma.documentClassification.deleteMany(),
      prisma.document.deleteMany(),
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

    // Reference data (capabilities, roles, role capabilities, county ->
    // subcounty -> ward) is rebuilt after the deletes so a fresh, complete
    // dataset is guaranteed.
    execSync("pnpm --filter @ward-ops/database db:seed", {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "inherit",
    });

    const ncc = await prisma.county.findUniqueOrThrow({ where: { code: "NCC" } });

    const mombasa = await prisma.county.upsert({
      where: { code: "MOMBASA" },
      update: {},
      create: { code: "MOMBASA", name: "Mombasa County" },
    });

    const langata = await prisma.subcounty.upsert({
      where: { code: "LANGATA" },
      update: {},
      create: { code: "LANGATA", name: "Langata", countyId: ncc.id },
    });
    await prisma.ward.upsert({
      where: { code: "WOODLEY" },
      update: {},
      create: { code: "WOODLEY", name: "Woodley", subcountyId: langata.id },
    });

    const likoni = await prisma.subcounty.upsert({
      where: { code: "LIKONI" },
      update: {},
      create: { code: "LIKONI", name: "Likoni", countyId: mombasa.id },
    });
    await prisma.ward.upsert({
      where: { code: "LIKONI_WARD" },
      update: {},
      create: { code: "LIKONI_WARD", name: "Likoni Ward", subcountyId: likoni.id },
    });
  } finally {
    await prisma.$disconnect();
  }
}