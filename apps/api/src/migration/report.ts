/**
 * Migration report model. Every migrated entity is counted, every file is
 * classified by outcome, and any unverified/corrupt evidence is reported
 * explicitly rather than migrated silently (§5).
 */

export type FileOutcome =
  | "MIGRATED"
  | "MISSING_FILE"
  | "HASH_MISMATCH"
  | "METADATA_MISSING"
  | "UPLOAD_FAILED"
  | "VERIFY_FAILED";

export interface FileMigrationRecord {
  legacyTable: "work_photos" | "documents";
  legacyId: number;
  storageKey: string;
  outcome: FileOutcome;
  objectKey?: string;
  sha256?: string;
  detail?: string;
}

export interface TableCount {
  source: number;
  migrated: number;
  failed: number;
  failures: string[];
}

export type TableCounts = Record<string, TableCount>;

export interface ReconciliationReport {
  objectsWithoutMetadata: string[];
  metadataWithoutObject: string[];
}

export interface MigrationReport {
  tool: string;
  legacyDb: string;
  legacyDocRoot: string;
  startedAt: string;
  finishedAt: string;
  counts: TableCounts;
  files: FileMigrationRecord[];
  reconciliation: ReconciliationReport;
  notes: string[];
  success: boolean;
}

export function emptyTableCount(): TableCount {
  return { source: 0, migrated: 0, failed: 0, failures: [] };
}

export function summarizeCounts(counts: TableCounts): string[] {
  const lines: string[] = [];
  for (const [table, count] of Object.entries(counts).sort()) {
    lines.push(
      `${table}: ${count.migrated}/${count.source} migrated` +
        (count.failed > 0 ? ` (${count.failed} failed)` : ""),
    );
  }
  return lines;
}