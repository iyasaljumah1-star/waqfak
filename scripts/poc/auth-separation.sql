-- PROOF OF CONCEPT ONLY — owner's order of 2026-11-08 («ثانياً»/1). Applied by scripts/poc/auth-separation.ts to an
-- ISOLATED local database (waqfak_authpoc, a copy of the test catalog), never to development, staging or production.
-- It is NOT part of security.sql or of any migration: adopting it changes the production roles and authentication and
-- needs the owner's explicit approval (docs/security/AUTH-DB-ROLE-SEPARATION.md).
--
-- The mechanism: the application role no longer says who it is. Identity is BOUND, per transaction, by a SECURITY
-- DEFINER function that validates a live session from the server's keyed hash of the cookie; the variable app.user_id
-- is ignored. The tables that make identity and authority — sessions, users' standing and credentials, user_roles,
-- role_permissions — are not writable by the application role at all, in any context (the «system context» included);
-- they change only through the authentication role's connection (login, OTP, password, MFA) or through definer
-- functions that check the BOUND identity's authority.

-- ── roles ──────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waqfak_auth') THEN CREATE ROLE waqfak_auth NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waqfak_authsvc') THEN CREATE ROLE waqfak_authsvc LOGIN PASSWORD 'poc-local-only' IN ROLE waqfak_auth; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO waqfak_auth;
GRANT SELECT, INSERT, UPDATE ON sessions, users, user_roles TO waqfak_auth;
GRANT DELETE ON user_roles TO waqfak_auth;
GRANT SELECT ON roles, permissions, role_permissions TO waqfak_auth;
GRANT INSERT ON audit_logs TO waqfak_auth;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO waqfak_auth;

-- the authentication role sees and writes the identity tables whatever their row-level policies for the application
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['sessions','users','user_roles','role_permissions','roles','permissions','audit_logs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS auth_all ON %I', t);
    EXECUTE format('CREATE POLICY auth_all ON %I FOR ALL TO waqfak_auth USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- ── the binding ────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_context (pid integer PRIMARY KEY, xact xid8 NOT NULL, user_id uuid NOT NULL, session_id uuid NOT NULL, mfa boolean NOT NULL, bound_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE auth_context OWNER TO waqfak_auth;
REVOKE ALL ON auth_context FROM PUBLIC, waqfak_app;

-- the server passes lookupHash("session|"+cookie) — computed with HASH_KEY, which the database never holds
CREATE OR REPLACE FUNCTION auth_bind(token_hash text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record;
BEGIN
  DELETE FROM auth_context WHERE pid = pg_backend_pid();
  SELECT x.id, x.user_id, x.mfa_verified INTO s FROM sessions x JOIN users u ON u.id = x.user_id
   WHERE x.token_hash = auth_bind.token_hash AND x.revoked_at IS NULL AND x.idle_expires_at > now() AND x.absolute_expires_at > now()
     AND u.status = 'active' AND (u.locked_until IS NULL OR u.locked_until < now());
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO auth_context (pid, xact, user_id, session_id, mfa) VALUES (pg_backend_pid(), pg_current_xact_id(), s.user_id, s.id, s.mfa_verified);
  RETURN s.user_id;
END $$;
ALTER FUNCTION auth_bind(text) OWNER TO waqfak_auth;
REVOKE ALL ON FUNCTION auth_bind(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_bind(text) TO waqfak_app;

-- the bound identity of THIS transaction on THIS backend — never the variable app.user_id
CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT user_id FROM auth_context WHERE pid = pg_backend_pid() AND xact = pg_current_xact_id()
$$;
ALTER FUNCTION app_current_user() OWNER TO waqfak_auth;
CREATE OR REPLACE FUNCTION app_bound_mfa() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT mfa FROM auth_context WHERE pid = pg_backend_pid() AND xact = pg_current_xact_id()), false)
$$;
ALTER FUNCTION app_bound_mfa() OWNER TO waqfak_auth;
GRANT EXECUTE ON FUNCTION app_current_user(), app_bound_mfa() TO waqfak_app;
GRANT EXECUTE ON FUNCTION app_holds(text), app_is_staff() TO waqfak_auth;

-- ── what the application role can no longer do, in any context ──────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON user_roles, role_permissions FROM waqfak_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON sessions FROM waqfak_app;
REVOKE SELECT ON sessions FROM waqfak_app;
GRANT SELECT (id, user_id, mfa_verified, ip, user_agent, device_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at, revoke_reason) ON sessions TO waqfak_app;
REVOKE INSERT, UPDATE ON users FROM waqfak_app;
REVOKE SELECT ON users FROM waqfak_app;
GRANT SELECT (id, phone, email, full_name, id_type, birth_date, locale, numeral_style, calendar_pref, status, is_staff, mfa_enabled, phone_verified_at, email_verified_at, locked_until, last_login_at, deletion_requested_at, resides_in_ksa, created_at, updated_at, created_by, updated_by) ON users TO waqfak_app;
-- the profile a person edits for themselves (the existing users_standing_guard keeps it to self or admin.users — now
-- against the bound identity)
GRANT UPDATE (full_name, email, email_verified_at, numeral_style, calendar_pref, deletion_requested_at, updated_at, updated_by) ON users TO waqfak_app;

-- without a bound identity (the former «system context»), the application role changes no account at all: the flows
-- that did (login, OTP, recovery, MFA, the last-login stamp) move to the authentication role's connection
CREATE OR REPLACE FUNCTION users_bound_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF session_user = 'waqfak_app' AND app_current_user() IS NULL THEN
    RAISE EXCEPTION 'users: changed only by a bound identity (or by the authentication role)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_bound_only ON users;
CREATE TRIGGER users_bound_only BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION users_bound_only();

-- ── authority through definer functions that check the BOUND identity ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auth_grant_role(target uuid, role_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := app_current_user(); r uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'auth_grant_role: no bound identity (a live session is required)' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NOT app_bound_mfa() THEN RAISE EXCEPTION 'auth_grant_role: the session has not passed the second factor' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF target = me THEN RAISE EXCEPTION 'auth_grant_role: an administrator does not grant to themselves' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NOT app_holds('admin.roles') THEN RAISE EXCEPTION 'auth_grant_role: admin.roles is required' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT id INTO r FROM roles WHERE key = role_key;
  IF r IS NULL THEN RAISE EXCEPTION 'auth_grant_role: unknown role'; END IF;
  INSERT INTO user_roles (user_id, role_id) VALUES (target, r) ON CONFLICT DO NOTHING;
END $$;
ALTER FUNCTION auth_grant_role(uuid, text) OWNER TO waqfak_auth;
REVOKE ALL ON FUNCTION auth_grant_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_grant_role(uuid, text) TO waqfak_app;

-- revoking one's own session (logout) or, for admin.users, another's
CREATE OR REPLACE FUNCTION auth_revoke_session(sid uuid, reason text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := app_current_user(); owner uuid;
BEGIN
  SELECT user_id INTO owner FROM sessions WHERE id = sid;
  IF me IS NULL OR owner IS NULL OR (owner <> me AND NOT app_holds('admin.users')) THEN RETURN false; END IF;
  UPDATE sessions SET revoked_at = now(), revoke_reason = reason WHERE id = sid AND revoked_at IS NULL;
  RETURN true;
END $$;
ALTER FUNCTION auth_revoke_session(uuid, text) OWNER TO waqfak_auth;
REVOKE ALL ON FUNCTION auth_revoke_session(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_revoke_session(uuid, text) TO waqfak_app;
