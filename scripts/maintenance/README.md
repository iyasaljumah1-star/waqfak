# Maintenance scripts (run by hand, never by the release)

## Trial accounts cleanup

Resets client accounts used for trials to the state of a new client: their trial waqfs and requests and everything
scoped to them are deleted; the accounts themselves (id, phone, login, roles, sessions, consents) and every audit log
are kept. Run inside the app container (it reaches the private database and has `psql`), with the owner/admin role.

1. **Backup first**: `pg_dump "$DATABASE_ADMIN_URL" -Fc -f /data/backups/pre-cleanup-<date>.dump`, then restore it into a
   scratch database and compare row counts (as `scripts/staging/predeploy-backup.sh` does).
2. **Report (read-only)**: `test-accounts-report.sql` — the accounts, their trial waqfs (created by them, with no other
   member), requests, rows per table, account-level records, kept data, files, and the orphan baseline.
3. **Dry run**: `test-accounts-cleanup.sql` with `execute=no`, the approved waqf ids and the expected counts.
4. **Run**: the same with `execute=yes` (one transaction; guards abort it unchanged if anything differs from the report
   or if a row outside the scope still references the data).
5. **Files**: `remove-blobs.sh <keys file>` removes the listed encrypted files under `$STORAGE_DIR/blobs` only.
6. **Check**: run the report again (all sections empty, orphan baseline unchanged) and log in with each account.

Rehearsed on a full copy of the local database: only the scoped tables changed (and by exactly the reported rows);
accounts, audit log (hash chain), services, workflows, roles, settings, sessions and consents identical; the accounts
log in and start a new request.
