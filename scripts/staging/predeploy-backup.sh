#!/bin/sh
# Pre-migration backup gate for single-container hosts (Railway): runs from start.sh BEFORE `db:migrate`, only when the
# release carries migrations the database has not applied yet.
#   1. pg_dump (custom format) of the app database to $DATA_DIR/backups (the persistent volume);
#   2. restores it into a scratch database on the same server and compares, table by table, the exact row counts and
#      the applied-migration count with the source; drops the scratch database;
#   3. any failure exits non-zero → the container stops → the platform keeps the previous deployment serving and
#      nothing is migrated.
# Prints no connection strings or keys. Disable with PREDEPLOY_BACKUP=false. Keeps the newest $BACKUP_KEEP dumps (5).
set -eu
umask 077   # dumps hold the whole database (encrypted fields, hashes): readable by the container user only
[ "${PREDEPLOY_BACKUP:-true}" = "false" ] && { echo "[predeploy] backup gate disabled (PREDEPLOY_BACKUP=false)"; exit 0; }

DATA_DIR="${DATA_DIR:-/data}"
DB_NAME="${STAGING_DB_NAME:-waqfak}"
KEEP="${BACKUP_KEEP:-5}"
: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL is required}"

# superuser connection to a given database on the same server (URL built in node: no secrets on the command line echo)
url_for() { DBN="$1" node -e 'const u=new URL(process.env.DATABASE_ADMIN_URL);u.pathname="/"+process.env.DBN;process.stdout.write(u.toString())'; }
SRC=$(url_for "$DB_NAME")
ADMIN=$(url_for "postgres")
q() { psql "$1" -v ON_ERROR_STOP=1 -XAtqc "$2"; }

journal=$(node -e 'process.stdout.write(String(require("./drizzle/meta/_journal.json").entries.length))')
# an unreachable database is a failure, never "nothing to back up"
q "$SRC" "select 1" >/dev/null || { echo "[predeploy] FAIL: cannot connect to the application database — deployment stopped"; exit 1; }
if [ "$(q "$SRC" "select to_regclass('drizzle.__drizzle_migrations') is null")" = "t" ]; then
  echo "[predeploy] new database (no migrations table yet): nothing to back up"; exit 0
fi
applied=$(q "$SRC" "select count(*) from drizzle.__drizzle_migrations")
if [ "$applied" = "0" ]; then echo "[predeploy] new database (no migrations applied): nothing to back up"; exit 0; fi
if [ "$applied" -ge "$journal" ]; then echo "[predeploy] no pending migrations ($applied/$journal): backup not needed"; exit 0; fi
echo "[predeploy] pending migrations: $applied applied, $journal in this release → backup + restore check"

command -v pg_dump >/dev/null && command -v pg_restore >/dev/null || { echo "[predeploy] FAIL: pg_dump/pg_restore not installed"; exit 1; }
server=$(q "$SRC" "show server_version_num")
client=$(pg_dump --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')
[ "$client" -ge "$((server / 10000))" ] || { echo "[predeploy] FAIL: pg_dump $client is older than server $server"; exit 1; }

mkdir -p "$DATA_DIR/backups"
size=$(q "$SRC" "select pg_database_size(current_database())")
free=$(df -Pk "$DATA_DIR/backups" | awk 'NR==2 {print $4 * 1024}')
[ "$free" -gt "$((size * 2))" ] || { echo "[predeploy] FAIL: not enough space on the volume ($free bytes free, database $size bytes)"; exit 1; }

stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="$DATA_DIR/backups/pre-migrate-$stamp-m$applied.dump"
pg_dump "$SRC" -Fc -f "$file"
sum=$(sha256sum "$file" | cut -d' ' -f1)
echo "[predeploy] dump written: $(basename "$file") ($(wc -c < "$file") bytes, sha256 $sum)"

# exact row count per table (all user schemas), as "schema.table|rows" lines, sorted
COUNTS="select n.nspname||'.'||c.relname||'|'||(xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' order by 1"

scratch="${DB_NAME}_restorecheck_$(date -u +%s)"
cleanup() { psql "$ADMIN" -XAtqc "drop database if exists \"$scratch\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT
q "$ADMIN" "create database \"$scratch\""
pg_restore -d "$(url_for "$scratch")" --exit-on-error "$file"
src_counts=$(q "$SRC" "$COUNTS")
dst_counts=$(q "$(url_for "$scratch")" "$COUNTS")
dst_applied=$(q "$(url_for "$scratch")" "select count(*) from drizzle.__drizzle_migrations")
tables=$(printf '%s\n' "$src_counts" | wc -l)
rows=$(printf '%s\n' "$src_counts" | awk -F'|' '{s+=$2} END {print s+0}')
if [ "$src_counts" != "$dst_counts" ] || [ "$dst_applied" != "$applied" ]; then
  echo "[predeploy] FAIL: restored copy differs from the source (tables/rows or migrations) — deployment stopped"
  printf '%s\n' "$src_counts" > "$DATA_DIR/backups/restorecheck-$stamp.src"; printf '%s\n' "$dst_counts" > "$DATA_DIR/backups/restorecheck-$stamp.dst"
  exit 1
fi
cleanup; trap - EXIT
echo "[predeploy] restore verified: $tables tables, $rows rows, $applied migrations identical in a scratch copy (dropped)"

printf '{"file":"%s","sha256":"%s","bytes":%s,"tables":%s,"rows":%s,"migrationsApplied":%s,"releaseMigrations":%s,"restoreVerified":true,"at":"%s"}\n' \
  "$(basename "$file")" "$sum" "$(wc -c < "$file")" "$tables" "$rows" "$applied" "$journal" "$stamp" > "$DATA_DIR/backups/last.json"
# retention: newest $KEEP dumps
ls -1t "$DATA_DIR"/backups/pre-migrate-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old"; done
echo "[predeploy] OK"
