#!/usr/bin/env bash
set -euo pipefail

# Backup helper for the production stack.
#
#   ./scripts/backup.sh <BACKUP_DIR>
#
# Writes a PostgreSQL dump (custom format, gzip-compressed) and a tarball of
# the object-store document volume. Database and object backups are written to
# the same timestamped directory so they can be restored together (metadata in
# PostgreSQL references object keys, so the two must stay aligned).
#
# Env:
#   DATABASE_URL   PostgreSQL connection string (default postgresql://ward_ops:ward_ops@localhost:5432/ward_ops)
#   DOCUMENT_ROOT  object-store volume root to archive (default data/objects)
#
# Examples:
#   DATABASE_URL=$RAILWAY_PG_URL DOCUMENT_ROOT=/app/data/documents ./scripts/backup.sh /var/backups/makina

BACKUP_DIR="${1:?usage: scripts/backup.sh <BACKUP_DIR>}"
DATABASE_URL="${DATABASE_URL:-postgresql://ward_ops:ward_ops@localhost:5432/ward_ops}"
DOCUMENT_ROOT="${DOCUMENT_ROOT:-data/objects}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_DIR/$STAMP"
mkdir -p "$TARGET"

echo "Backing up database -> $TARGET/db.dump"
pg_dump --format=custom --no-owner --no-acl --dbname="$DATABASE_URL" >"$TARGET/db.dump"

if [ -d "$DOCUMENT_ROOT" ]; then
  echo "Backing up documents -> $TARGET/documents.tar.gz"
  tar -czf "$TARGET/documents.tar.gz" -C "$(dirname "$DOCUMENT_ROOT")" "$(basename "$DOCUMENT_ROOT")"
else
  echo "Document root $DOCUMENT_ROOT does not exist; skipping documents."
fi

echo "Backup complete: $TARGET"
echo "Verify integrity before relying on it: pg_restore --list $TARGET/db.dump | head"
