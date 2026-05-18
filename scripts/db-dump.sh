#!/bin/bash
set -e

DB_URL="${RAILWAY_DB:-$1}"

if [ -z "$DB_URL" ]; then
  echo "Usage: RAILWAY_DB=postgresql://... ./scripts/db-dump.sh"
  echo "   or: ./scripts/db-dump.sh postgresql://..."
  exit 1
fi

TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
OUTPUT="scripts/backup_${TIMESTAMP}.dump"

echo "Dumping database to ${OUTPUT}..."
docker run --rm \
  -v "$(pwd):/backup" \
  postgres:18 \
  pg_dump "$DB_URL" -Fc -f "/backup/backup_${TIMESTAMP}.dump"
echo "Done. File: ${OUTPUT} ($(du -sh "$OUTPUT" | cut -f1))"
