#!/usr/bin/env bash
# TEST CLUSTER ONLY (stage 11). Creates the authentication and system logins of scripts/db-bootstrap.sql on the local
# throwaway cluster, with passwords drawn here and kept outside the repository (in $ROLES_FILE, mode 600), and grants
# CONNECT on the local test databases. Never run against production: that needs the owner's approval.
set -euo pipefail
ROLES_FILE="${ROLES_FILE:-$HOME/.waqfak-test-roles}"
if [[ ! -f "$ROLES_FILE" ]]; then
  umask 077
  printf 'AUTH_PW=%s\nSYSTEM_PW=%s\n' "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > "$ROLES_FILE"
fi
# shellcheck disable=SC1090
. "$ROLES_FILE"
sudo -n -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waqfak_auth') THEN CREATE ROLE waqfak_auth NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waqfak_system') THEN CREATE ROLE waqfak_system NOLOGIN; END IF;
END \$\$;
ALTER ROLE waqfak_auth LOGIN PASSWORD '$AUTH_PW';
ALTER ROLE waqfak_system LOGIN PASSWORD '$SYSTEM_PW';
GRANT waqfak_app TO waqfak_system;
-- the test harness (owner connection) runs its cases as the system role with SET LOCAL ROLE, and resets the role for
-- its synthetic fixtures (test accounts, their roles and sessions, inside the rolled-back case): test cluster only
GRANT waqfak_system TO waqfak_owner;
REVOKE waqfak_system FROM waqfak_app;
REVOKE waqfak_auth FROM waqfak_app;
SQL
for db in ${TEST_DATABASES:-waqfak_dev waqfak_ke_test waqfak_refs_test}; do
  sudo -n -u postgres psql -v ON_ERROR_STOP=1 -q -d "$db" -c "GRANT CONNECT ON DATABASE $db TO waqfak_auth, waqfak_system;"
done
echo "roles ready (passwords in $ROLES_FILE)"
