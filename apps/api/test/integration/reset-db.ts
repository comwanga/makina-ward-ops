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
  execSync("pnpm --filter @ward-ops/database db:seed", {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });

  const prisma = new PrismaClient();
  try {
    await prisma.$transaction([
      prisma.userSession.deleteMany(),
      prisma.auditEvent.deleteMany(),
      prisma.accessRequest.deleteMany(),
      prisma.user.deleteMany(),
    ]);

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