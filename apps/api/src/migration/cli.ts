import { writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@ward-ops/database";
import { loadConfig } from "../config/config";
import { LocalObjectStorage, S3ObjectStorage } from "../storage/object-storage.service";
import { readLegacyDatabase } from "./legacy-db";
import { LegacyMigrator } from "./migrator";

interface CliArgs {
  legacyDb: string;
  legacyDocRoot: string;
  reportOut: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    legacyDb: "data/makina.db",
    legacyDocRoot: "data/documents",
    reportOut: "migration-report.json",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--legacy-db" && value) {
      args.legacyDb = value;
      index += 1;
    } else if (arg === "--legacy-doc-root" && value) {
      args.legacyDocRoot = value;
      index += 1;
    } else if (arg === "--report-out" && value) {
      args.reportOut = value;
      index += 1;
    }
  }
  return args;
}

/**
 * Standalone migration CLI. Reads the legacy SQLite database plus its file
 * root, writes into the new PostgreSQL schema via Prisma, uploads evidence
 * through the broken-photo-safe flow, and writes a JSON migration report.
 *
 * Usage: tsx src/migration/cli.ts --legacy-db data/makina.db \
 *          --legacy-doc-root data/documents --report-out migration-report.json
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();

  const storage = config.storage.configured
    ? new S3ObjectStorage(config)
    : new LocalObjectStorage(config);

  const prisma = new PrismaClient();
  try {
    const rows = readLegacyDatabase(args.legacyDb);
    const migrator = new LegacyMigrator(
      { prisma, storage, legacyDb: args.legacyDb, legacyDocRoot: args.legacyDocRoot },
      rows,
    );
    const report = await migrator.run(args.legacyDb);

    const reportPath = path.resolve(args.reportOut);
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

    console.log(`Migration report written to ${reportPath}`);
    for (const line of migrator.summarize()) console.log(`  ${line}`);
    console.log(`Reconciliation: ${report.reconciliation.objectsWithoutMetadata.length} orphan objects, ${report.reconciliation.metadataWithoutObject.length} orphan metadata rows`);
    console.log(`Unreferenced legacy files (on disk, no DB metadata): ${report.unreferencedLegacyFiles.length}`);
    console.log(report.success ? "Migration succeeded." : "Migration completed with failures (see report).");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});