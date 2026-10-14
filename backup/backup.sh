#!/bin/bash
# Nightly database backup: pg_dump -> gzip -> /backups, then copied off the server with rclone.
# Run once by hand with:  docker compose -f docker-compose.prod.yml exec backup /backup.sh once
set -euo pipefail

BACKUP_HOUR_UTC="${BACKUP_HOUR_UTC:-08}" # 08:00 UTC = 3 AM Central (CDT) / 2 AM (CST)
KEEP_LOCAL_DAYS="${KEEP_LOCAL_DAYS:-7}"
KEEP_REMOTE_DAYS="${KEEP_REMOTE_DAYS:-30}"

# Off-server storage is configured through rclone environment variables (see DEPLOY.md), e.g.
#   RCLONE_CONFIG_OFFSITE_TYPE=s3  RCLONE_CONFIG_OFFSITE_PROVIDER=Other  RCLONE_CONFIG_OFFSITE_ENDPOINT=...
#   RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=...  RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=...
#   BACKUP_REMOTE_PATH=offsite:my-bucket/stevens-events
run_backup() {
  local stamp file
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  file="/backups/stevens-events-${stamp}.sql.gz"

  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h "${PGHOST:-db}" -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "${file}.tmp"
  mv "${file}.tmp" "$file"
  echo "[backup] wrote $file ($(du -h "$file" | cut -f1))"

  if [ -n "${BACKUP_REMOTE_PATH:-}" ]; then
    rclone copy "$file" "$BACKUP_REMOTE_PATH" && echo "[backup] uploaded to $BACKUP_REMOTE_PATH"
    rclone delete "$BACKUP_REMOTE_PATH" --min-age "${KEEP_REMOTE_DAYS}d" || true
  else
    echo "[backup] WARNING: BACKUP_REMOTE_PATH is not set, so this backup exists only on this server"
  fi

  find /backups -name 'stevens-events-*.sql.gz' -mtime "+${KEEP_LOCAL_DAYS}" -delete
}

if [ "${1:-}" = "once" ]; then
  run_backup
  exit 0
fi

echo "[backup] scheduler started; backing up daily at ${BACKUP_HOUR_UTC}:00 UTC"
last_day=""
while true; do
  today="$(date -u +%Y-%m-%d)"
  if [ "$(date -u +%H)" = "$BACKUP_HOUR_UTC" ] && [ "$today" != "$last_day" ]; then
    # A failed backup must be loud but must not stop tomorrow's attempt.
    if run_backup; then last_day="$today"; else echo "[backup] FAILED"; last_day="$today"; fi
  fi
  sleep 60
done
