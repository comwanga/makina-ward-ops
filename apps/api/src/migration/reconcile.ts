import type { PrismaClient } from "@ward-ops/database";
import { NotFoundException } from "@nestjs/common";
import type { ObjectStorage } from "../storage/object-storage.service";
import type { ReconciliationReport } from "./report";

/**
 * Reconciliation tooling (§5, §24): detect
 *   (a) stored objects with no database metadata, and
 *   (b) database metadata whose object is missing from storage.
 * Runs read-only against a copy; original evidence is never modified.
 */
export async function reconcileEvidence(
  prisma: PrismaClient,
  storage: ObjectStorage,
): Promise<ReconciliationReport> {
  const [evidenceRows, documentRows, storedObjects] = await Promise.all([
    prisma.evidence.findMany({ select: { objectKey: true } }),
    prisma.document.findMany({ select: { objectKey: true } }),
    storage.list(),
  ]);

  const metadataKeys = new Set<string>();
  for (const row of evidenceRows) metadataKeys.add(row.objectKey);
  for (const row of documentRows) metadataKeys.add(row.objectKey);

  const objectsWithoutMetadata = storedObjects.filter((key) => !metadataKeys.has(key));

  const metadataWithoutObject: string[] = [];
  for (const key of metadataKeys) {
    try {
      await storage.read(key);
    } catch (error) {
      if (error instanceof NotFoundException) {
        metadataWithoutObject.push(key);
      } else {
        metadataWithoutObject.push(`${key} (${String(error)})`);
      }
    }
  }

  return {
    objectsWithoutMetadata,
    metadataWithoutObject: metadataWithoutObject.sort(),
  };
}