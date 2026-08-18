#!/usr/bin/env bash
set -euo pipefail

# Backup helper for the production stack.
#
#   ./scripts/backup.sh <BACKUP_DIR>
#
# Writes a PostgreSQL dump (custom format, gzip-compressed) and, for local
# object storage, a tarball of the document volume. Database and object backups
# are written to the same timestamped directory so they can be restored together
# (metadata in PostgreSQL references object keys, so the two must stay aligned).
#
# When S3 object storage is configured (S3_BUCKET / S3_ACCESS_KEY_ID) evidence
# lives in the external object store, not on the container filesystem, so this
# script backs up the database only and prints a prominent warning that the
# object store must be protected separately (bucket snapshots/lifecycle).
#
# Env:
#   DATABASE_URL      PostgreSQL connection string (default postgresql://ward_ops:ward_ops@localhost:5432/ward_ops)
#   DOCUMENT_ROOT     object-store volume root to archive (default data/objects;
#                     falls back to DOCUMENT_STORE_DIR, the app's variable name)
#
# Examples:
#   DATABASE_URL=$RAILWAY_PG_URL DOCUMENT_ROOT=/app/data/documents ./scripts/backup.sh /var/backups/makina

BACKUP_DIR="${1:?usage: scripts/backup.sh <BACKUP_DIR>}"
DATABASE_URL="${DATABASE_URL:-postgresql://ward_ops:ward_ops@localhost:5432/ward_ops}"
DOCUMENT_ROOT="${DOCUMENT_ROOT:-${DOCUMENT_STORE_DIR:-data/objects}}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_DIR/$STAMP"
mkdir -p "$TARGET"

echo "Backing up database -> $TARGET/db.dump"
pg_dump --format=custom --no-owner --no-acl --dbname="$DATABASE_URL" >"$TARGET/db.dump"

if [ -n "${S3_BUCKET:-}" ] || [ -n "${S3_ACCESS_KEY_ID:-}" ]; then
  echo "WARNING: S3 object storage is configured (S3_BUCKET/S3_ACCESS_KEY_ID)."
  echo "Evidence is stored in the external object store, NOT in DOCUMENT_ROOT."
  echo "This script backs up the database only; object-store evidence must be"
  echo "protected by the storage provider (bucket snapshots/lifecycle/versioning)."
  echo "Skipping local document volume archive."
else
  if [ -d "$DOCUMENT_ROOT" ]; then
    echo "Backing up documents -> $TARGET/documents.tar.gz"
    tar -czf "$TARGET/documents.tar.gz" -C "$(dirname "$DOCUMENT_ROOT")" "$(basename "$DOCUMENT_ROOT")"
  else
    echo "WARNING: Document root $DOCUMENT_ROOT does not exist; skipping documents."
  fi
fi

echo "Backup complete: $TARGET"
echo "Verify integrity before relying on it: pg_restore --list $TARGET/db.dump | head"
