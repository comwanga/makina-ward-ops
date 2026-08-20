#!/usr/bin/env bash
set -euo pipefail

# Synthetic end-to-end recovery drill (Phase 10 DoD).
#
# Exercises the full backup -> destroy -> restore cycle against a scratch
# PostgreSQL database using the real application migration/seed tooling and a
# synthetic dataset, then verifies the restored data is complete and that the
# API reports /health/ready.
#
# Prereq: a reachable PostgreSQL server and a scratch database that may be
# destroyed. Set DATABASE_URL to the scratch database URL, e.g.
#
#   DATABASE_URL=postgresql://ward_ops:ward_ops@localhost:5432/ward_ops_drill \
#     ./scripts/recovery-drill.sh
#
# Exits non-zero if any step of the recovery chain fails.

DATABASE_URL="${DATABASE_URL:?DATABASE_URL must point to a scratch database}"
RECOVERY_DRILL_CONFIRM="${RECOVERY_DRILL_CONFIRM:-}"
DB_PATH="${DATABASE_URL%%\?*}"
DB_NAME="${DB_PATH##*/}"
if [[ "$RECOVERY_DRILL_CONFIRM" != "DROP-$DB_NAME" ]]; then
  echo "Refusing destructive recovery drill. Set RECOVERY_DRILL_CONFIRM=DROP-$DB_NAME." >&2
  exit 2
fi
if [[ ! "$DB_NAME" =~ (test|scratch|drill) ]] || [[ "$DATABASE_URL" =~ (railway|production|prod) ]]; then
  echo "Refusing recovery drill for non-scratch database '$DB_NAME'." >&2
  exit 2
fi
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$(mktemp -d /tmp/makina-recovery-XXXXXX)"
WORK_DIR="$(mktemp -d /tmp/makina-recovery-work-XXXXXX)"
DOCUMENT_ROOT="$WORK_DIR/documents"
mkdir -p "$DOCUMENT_ROOT"

cleanup() {
  rm -rf "$BACKUP_DIR" "$WORK_DIR"
}
trap cleanup EXIT

cd "$REPO_ROOT"

echo "==> Building workspace packages"
pnpm --filter @ward-ops/database build

echo "==> Applying schema migrations"
pnpm --filter @ward-ops/database db:deploy

echo "==> Seeding reference data"
pnpm --filter @ward-ops/database db:seed

echo "==> Loading synthetic operational data (employees, attendance, evidence)"
DOCUMENT_STORE_DIR="$DOCUMENT_ROOT" pnpm --filter @ward-ops/database exec tsx "$REPO_ROOT/scripts/recovery-load.ts"

echo "==> Backing up database and document volume"
DOCUMENT_ROOT="$DOCUMENT_ROOT" DATABASE_URL="$DATABASE_URL" scripts/backup.sh "$BACKUP_DIR"
BACKUP_DIRECTORY="$(ls -1d "$BACKUP_DIR"/* | head -n1)"

echo "==> Destroying the database"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
SQL

echo "==> Restoring from backup"
DATABASE_URL="$DATABASE_URL" DOCUMENT_ROOT="$DOCUMENT_ROOT" scripts/restore.sh "$BACKUP_DIRECTORY" "$DATABASE_URL"

echo "==> Verifying restored data and object store"
DOCUMENT_STORE_DIR="$DOCUMENT_ROOT" pnpm --filter @ward-ops/database exec tsx "$REPO_ROOT/scripts/recovery-verify.ts"

echo "==> Recovery drill passed: database and evidence restored and verified."
