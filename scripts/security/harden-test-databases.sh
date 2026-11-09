#!/usr/bin/env bash
# TEST DATABASES ONLY (owner's order of 2026-11-09, «ثانياً»/3). Revokes TEMPORARY from PUBLIC — and so from the
# application role, which holds it only through PUBLIC — on the local test databases, keeping it for the owner (the
# maintenance scripts use temporary tables). Never run against production: that needs the owner's approval
# (see docs/security/AUTH-DB-ROLE-SEPARATION.md, decisions). Usage: scripts/security/harden-test-databases.sh
set -euo pipefail
for db in waqfak_dev waqfak_ke_test waqfak_refs_test; do
  sudo -n -u postgres psql -v ON_ERROR_STOP=1 -q -d "$db" -c "REVOKE TEMPORARY ON DATABASE $db FROM PUBLIC; GRANT TEMPORARY ON DATABASE $db TO waqfak_owner;"
  sudo -n -u postgres psql -Atq -d "$db" -c "select '$db', 'waqfak_app TEMP=' || has_database_privilege('waqfak_app', '$db', 'TEMP'), 'waqfak_mlro TEMP=' || has_database_privilege('waqfak_mlro', '$db', 'TEMP'), 'waqfak_owner TEMP=' || has_database_privilege('waqfak_owner', '$db', 'TEMP')"
done
