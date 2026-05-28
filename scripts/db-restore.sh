#!/bin/bash
set -e

if [ -n "$RAILWAY_DB_TARGET" ]; then
  TARGET_DB="$RAILWAY_DB_TARGET"
  DUMP_FILE="${1:-}"
else
  TARGET_DB="${1:-}"
  DUMP_FILE="${2:-}"
fi

if [ -z "$TARGET_DB" ] || [ -z "$DUMP_FILE" ]; then
  echo "Usage: RAILWAY_DB_TARGET=postgresql://... ./scripts/db-restore.sh <dump-file>"
  echo "   or: ./scripts/db-restore.sh postgresql://... <dump-file>"
  exit 1
fi

if [ ! -f "$DUMP_FILE" ]; then
  echo "Error: dump file not found: $DUMP_FILE"
  exit 1
fi

echo "Restoring ${DUMP_FILE} to target database..."
echo "WARNING: This will overwrite existing data in the target database."
read -p "Proceed? [y/N] " confirm
if [ "$(echo "$confirm" | tr '[:upper:]' '[:lower:]')" != "y" ]; then
  echo "Aborted."
  exit 0
fi

docker run --rm \
  -v "$(pwd):/backup" \
  postgres:18 \
  pg_restore \
    --no-owner \
    --no-privileges \
    -d "$TARGET_DB" \
    "/backup/${DUMP_FILE}"

echo "Done. Run --reset-sync on the target database before starting ponder."
