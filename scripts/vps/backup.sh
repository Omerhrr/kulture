#!/usr/bin/env bash
# Compressed Postgres dump into /opt/kulture-backups, keeping 14 days.
# Restore:  gunzip -c <file> | docker compose exec -T db psql -U kk -d kaduna
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=/opt/kulture-backups
mkdir -p "$OUT"
set -a; . ./.env; set +a
F="$OUT/kaduna-$(date +%Y%m%d-%H%M).sql.gz"
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-kk}" -d "${POSTGRES_DB:-kaduna}" --clean --if-exists | gzip > "$F"
find "$OUT" -name 'kaduna-*.sql.gz' -mtime +14 -delete
echo "backup ok: $F ($(du -h "$F" | cut -f1))"
