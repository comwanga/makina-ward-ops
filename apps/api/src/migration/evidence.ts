import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ObjectStorage, StorageFileInput } from "../storage/object-storage.service";
import type { FileMigrationRecord } from "./report";

export interface LegacyFile {
  legacyTable: "work_photos" | "documents";
  legacyId: number;
  storageKey: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Lists legacy filesystem files (in the legacy document root) that are not
 * referenced by any legacy database row. These are surfaced in the migration
 * report for human investigation — never fabricated, never given a relationship.
 */
export async function listUnreferencedLegacyFiles(
  legacyDocRoot: string,
  referencedKeys: ReadonlySet<string>,
): Promise<string[]> {
  const referencedNames = new Set(
    [...referencedKeys].map((key) => path.basename(key)),
  );
  let entries: string[];
  try {
    entries = await readdir(legacyDocRoot);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name !== ".gitkeep")
    .filter((name) => !referencedNames.has(name))
    .sort();
}

/**
 * Broken-photo-safe file migration (§5): migrate bytes to object storage only
 * when the database record, the legacy file, and the SHA-256 digest all agree.
 * Missing files and hash mismatches are reported, never fabricated, and the
 * legacy bytes are left in place (quarantine) on failure.
 */
export async function migrateLegacyFile(
  storage: ObjectStorage,
  legacyDocRoot: string,
  file: LegacyFile,
): Promise<FileMigrationRecord> {
  const legacyPath = path.join(legacyDocRoot, file.storageKey);
  const record: FileMigrationRecord = {
    legacyTable: file.legacyTable,
    legacyId: file.legacyId,
    storageKey: file.storageKey,
    outcome: "MISSING_FILE",
  };

  try {
    await access(legacyPath);
  } catch {
    record.outcome = "MISSING_FILE";
    record.detail = "Legacy file does not exist on disk";
    return record;
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(legacyPath);
  } catch (error) {
    record.outcome = "UPLOAD_FAILED";
    record.detail = `Unreadable legacy file: ${String(error)}`;
    return record;
  }

  if (buffer.length !== file.sizeBytes) {
    record.outcome = "HASH_MISMATCH";
    record.detail = `Size mismatch: expected ${file.sizeBytes}, found ${buffer.length}`;
    return record;
  }

  const actualSha256 = createHash("sha256").update(buffer).digest("hex");
  if (actualSha256 !== file.sha256) {
    record.outcome = "HASH_MISMATCH";
    record.detail = `SHA-256 mismatch: expected ${file.sha256}, found ${actualSha256}`;
    return record;
  }

  let stored;
  try {
    const input: StorageFileInput = {
      buffer,
      originalName: file.originalName,
      contentType: file.contentType,
    };
    stored = await storage.save(input);
  } catch (error) {
    record.outcome = "UPLOAD_FAILED";
    record.detail = String(error);
    return record;
  }

  record.objectKey = stored.objectKey;
  record.sha256 = stored.sha256;

  // Verify the stored object before recording metadata: a stored object whose
  // digest differs from what was uploaded must surface as an error, not as
  // successfully migrated evidence.
  try {
    const verified = await storage.read(stored.objectKey);
    const verifiedSha256 = createHash("sha256").update(verified).digest("hex");
    if (verifiedSha256 !== stored.sha256) {
      record.outcome = "VERIFY_FAILED";
      record.detail = "Stored object digest does not match uploaded digest";
      return record;
    }
  } catch (error) {
    record.outcome = "VERIFY_FAILED";
    record.detail = `Stored object could not be read back: ${String(error)}`;
    return record;
  }

  record.outcome = "MIGRATED";
  return record;
}