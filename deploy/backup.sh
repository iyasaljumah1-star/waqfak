#!/bin/sh
# Daily logical backup of the database + encrypted document blobs. Keep a copy OFF the server (see RUNBOOK.md).
set -e
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p /backups
pg_dump -h db -U postgres -d waqfak -Fc -f /backups/waqfak-$STAMP.dump
tar -C /data -czf /backups/storage-$STAMP.tgz storage
find /backups -type f -mtime +"${BACKUP_RETENTION_DAYS:-14}" -delete
echo "backup ok $STAMP"
