#!/usr/bin/env bash
set -euo pipefail

# Restore helper for the production stack.
#
#   ./scripts/restore.sh <BACKUP_DIR> <TARGET_DATABASE_URL>
#
# Restores the PostgreSQL custom dump from a backup directory produced by
# scripts/backup.sh. The target database must already exist. Object-store
# documents are restored by extracting the tarball over the document root —
# run this while the application is stopped or the volume is mounted read-only.
#
# Env:
#   DOCUMENT_ROOT  object-store volume root to restore into (default data/objects)
#
# Example:
#   scripts/restore.sh /var/backups/makina/20260818T120000Z "$RAILWAY_PG_URL"

BACKUP_DIR="${1:?usage: scripts/restore.sh <BACKUP_DIR> <TARGET_DATABASE_URL>}"
TARGET_DATABASE_URL="${2:?usage: scripts/restore.sh <BACKUP_DIR> <TARGET_DATABASE_URL>}"
DOCUMENT_ROOT="${DOCUMENT_ROOT:-data/objects}"

DB_DUMP="$BACKUP_DIR/db.dump"
DOCS_TAR="$BACKUP_DIR/documents.tar.gz"

[ -f "$DB_DUMP" ] || { echo "No $DB_DUMP in $BACKUP_DIR" >&2; exit 1; }

echo "Restoring database from $DB_DUMP"
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$TARGET_DATABASE_URL" "$DB_DUMP"

if [ -f "$DOCS_TAR" ]; then
  echo "Restoring documents into $DOCUMENT_ROOT"
  mkdir -p "$DOCUMENT_ROOT"
  tar -xzf "$DOCS_TAR" -C "$(dirname "$DOCUMENT_ROOT")"
fi

echo "Restore complete. Start the application and verify /health/ready and evidence reads."
