-- PROOF OF CONCEPT ONLY, version 2 (owner's order of 2026-11-09, «ثانياً»/5 — N9-1c). Applied by
-- scripts/poc/auth-separation.ts to an ISOLATED local database (waqfak_authpoc, a copy of the test catalog), never to
-- development, staging or production. It is NOT part of security.sql or of any migration: adopting it changes the
-- production roles and authentication and needs the owner's explicit approval (docs/security/AUTH-DB-ROLE-SEPARATION.md).
--
-- What version 1 got wrong (round 9, X1–X5): its functions resolved unqualified names with pg_temp first (a temporary
-- «auth_context», «sessions» or «users» bound the administrator); the «system context» — an unbound application
-- connection — kept global access to every waqf (memberships, documents); «app.global_access» was still a variable the
-- connection declares; DELETE on users was not revoked.
--
-- Version 2:
--   1. the binding lives in a schema of its own («auth», no USAGE for the application), every function is
--      schema-qualified AND runs with search_path «pg_catalog, public, pg_temp»;
--   2. the application role has NO system context: an unbound application connection is refused by app_current_user()
--      itself, so no policy or trigger can treat it as «the system»; work without a person (share links, login, the
--      engine's queue) runs on a separate role, «waqfak_system», which holds no table privilege at all — only EXECUTE
--      on definer functions that each do one operation (here: viewing one share);
--   3. global access is derived from the BOUND identity's roles (auth.global_roles, mirrored from the catalog), never
--      from «app.global_access», which is ignored;
--   4. identity tables: no INSERT/UPDATE/DELETE/TRUNCATE on user_roles, role_permissions, sessions; no INSERT, DELETE
--      or TRUNCATE on users and UPDATE only of the profile columns; no read of token hashes or password hashes;
--      deletion of an account through a definer function that needs a bound administrator with the second factor.

-- ── roles ──────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waqfak_auth') THEN CREATE ROLE waqfak_auth NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waqfak_authsvc') THEN CREATE ROLE waqfak_authsvc NOLOGIN IN ROLE waqfak_auth; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waqfak_system') THEN CREATE ROLE waqfak_system NOLOGIN; END IF;
END $$;
GRANT CONNECT ON DATABASE waqfak_authpoc TO waqfak_system, waqfak_authsvc;
GRANT USAGE ON SCHEMA public TO waqfak_auth, waqfak_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions, public.users, public.user_roles TO waqfak_auth;
GRANT SELECT ON public.roles, public.permissions, public.role_permissions, public.document_shares, public.documents TO waqfak_auth;
GRANT INSERT ON public.audit_logs TO waqfak_auth;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO waqfak_auth;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['sessions','users','user_roles','role_permissions','roles','permissions','audit_logs','document_shares','documents'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS auth_all ON public.%I', t);
    EXECUTE format('CREATE POLICY auth_all ON public.%I FOR ALL TO waqfak_auth USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.app_holds(text), public.app_is_staff(), public.app_can_access_waqf(uuid) TO waqfak_auth;

-- ── the binding, in a schema the application cannot reach ──────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION waqfak_auth;
REVOKE ALL ON SCHEMA auth FROM PUBLIC;
CREATE TABLE IF NOT EXISTS auth.context (pid integer PRIMARY KEY, xact xid8 NOT NULL, user_id uuid NOT NULL, session_id uuid NOT NULL, mfa boolean NOT NULL, bound_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE auth.context OWNER TO waqfak_auth;
REVOKE ALL ON auth.context FROM PUBLIC;
-- the roles that see every waqf (src/server/authz/catalog.ts, globalAccess: true) — maintained by migration in a real rollout
CREATE TABLE IF NOT EXISTS auth.global_roles (role_key text PRIMARY KEY);
ALTER TABLE auth.global_roles OWNER TO waqfak_auth;
INSERT INTO auth.global_roles VALUES ('super_admin'), ('management'), ('ops_manager'), ('nazara_manager') ON CONFLICT DO NOTHING;

-- the server passes lookupHash("session|"+cookie) — computed with HASH_KEY, which the database never holds
CREATE OR REPLACE FUNCTION public.auth_bind(token_hash text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE s record;
BEGIN
  DELETE FROM auth.context WHERE pid = pg_catalog.pg_backend_pid();
  SELECT x.id, x.user_id, x.mfa_verified INTO s FROM public.sessions x JOIN public.users u ON u.id = x.user_id
   WHERE x.token_hash = auth_bind.token_hash AND x.revoked_at IS NULL AND x.idle_expires_at > now() AND x.absolute_expires_at > now()
     AND u.status = 'active' AND (u.locked_until IS NULL OR u.locked_until < now());
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO auth.context (pid, xact, user_id, session_id, mfa) VALUES (pg_catalog.pg_backend_pid(), pg_catalog.pg_current_xact_id(), s.user_id, s.id, s.mfa_verified);
  RETURN s.user_id;
END $$;
ALTER FUNCTION public.auth_bind(text) OWNER TO waqfak_auth;
REVOKE ALL ON FUNCTION public.auth_bind(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_bind(text) TO waqfak_app;

-- the bound identity of THIS transaction on THIS backend. For the application role there is no «unbound = system»:
-- an unbound call is an error, so no policy or trigger can grant the system's latitude to a connection that merely
-- did not bind. Other roles (owner, authentication, system) are not the application and get NULL.
CREATE OR REPLACE FUNCTION public.app_current_user() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE u uuid;
BEGIN
  SELECT c.user_id INTO u FROM auth.context c WHERE c.pid = pg_catalog.pg_backend_pid() AND c.xact = pg_catalog.pg_current_xact_id();
  IF u IS NULL AND session_user = 'waqfak_app' THEN
    RAISE EXCEPTION 'no bound identity: the application role acts only for a person bound by auth_bind()' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN u;
END $$;
ALTER FUNCTION public.app_current_user() OWNER TO waqfak_auth;
CREATE OR REPLACE FUNCTION public.app_bound_mfa() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce((SELECT c.mfa FROM auth.context c WHERE c.pid = pg_catalog.pg_backend_pid() AND c.xact = pg_catalog.pg_current_xact_id()), false)
$$;
ALTER FUNCTION public.app_bound_mfa() OWNER TO waqfak_auth;
-- global access: the bound person's roles, never a variable the connection sets
CREATE OR REPLACE FUNCTION public.app_has_global_access() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id JOIN auth.global_roles g ON g.role_key = r.key
                 JOIN public.users u ON u.id = ur.user_id
                 WHERE ur.user_id = public.app_current_user() AND u.status = 'active' AND (u.locked_until IS NULL OR u.locked_until < now()))
$$;
ALTER FUNCTION public.app_has_global_access() OWNER TO waqfak_auth;
GRANT SELECT ON public.user_roles, public.roles, public.users TO waqfak_auth;
GRANT EXECUTE ON FUNCTION public.app_current_user(), public.app_bound_mfa(), public.app_has_global_access() TO waqfak_app, waqfak_auth;

-- ── what the application role can no longer do, in any context ──────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_roles, public.role_permissions, public.sessions FROM waqfak_app;
REVOKE SELECT ON public.sessions FROM waqfak_app;
GRANT SELECT (id, user_id, mfa_verified, ip, user_agent, device_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at, revoke_reason) ON public.sessions TO waqfak_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.users FROM waqfak_app;
REVOKE SELECT ON public.users FROM waqfak_app;
GRANT SELECT (id, phone, email, full_name, id_type, birth_date, locale, numeral_style, calendar_pref, status, is_staff, mfa_enabled, phone_verified_at, email_verified_at, locked_until, last_login_at, deletion_requested_at, resides_in_ksa, created_at, updated_at, created_by, updated_by) ON public.users TO waqfak_app;
GRANT UPDATE (full_name, email, email_verified_at, numeral_style, calendar_pref, deletion_requested_at, updated_at, updated_by) ON public.users TO waqfak_app;
-- the second factor and the one-time codes are the authentication role's alone (they had no RLS: any application
-- connection could read or replace them)
REVOKE ALL ON public.mfa_factors, public.recovery_codes, public.otp_challenges FROM waqfak_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mfa_factors, public.recovery_codes, public.otp_challenges TO waqfak_auth;
-- a second line behind the privileges: no deletion of an account by the application role, whatever is granted later
CREATE OR REPLACE FUNCTION public.users_no_app_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  -- current_user, not session_user: inside auth_delete_user() (a definer) the effective role is waqfak_auth
  IF current_user = 'waqfak_app' THEN RAISE EXCEPTION 'users: an account is deleted only through auth_delete_user()' USING ERRCODE = 'insufficient_privilege'; END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS users_no_app_delete ON public.users;
CREATE TRIGGER users_no_app_delete BEFORE DELETE ON public.users FOR EACH ROW EXECUTE FUNCTION public.users_no_app_delete();

-- ── authority through definer functions that check the BOUND identity ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_grant_role(target uuid, role_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE me uuid := public.app_current_user(); r uuid;
BEGIN
  IF NOT public.app_bound_mfa() THEN RAISE EXCEPTION 'auth_grant_role: the session has not passed the second factor' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF target = me THEN RAISE EXCEPTION 'auth_grant_role: an administrator does not grant to themselves' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NOT public.app_holds('admin.roles') THEN RAISE EXCEPTION 'auth_grant_role: admin.roles is required' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT id INTO r FROM public.roles WHERE key = role_key;
  IF r IS NULL THEN RAISE EXCEPTION 'auth_grant_role: unknown role'; END IF;
  INSERT INTO public.user_roles (user_id, role_id) VALUES (target, r) ON CONFLICT DO NOTHING;
END $$;
ALTER FUNCTION public.auth_grant_role(uuid, text) OWNER TO waqfak_auth;
REVOKE ALL ON FUNCTION public.auth_grant_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_grant_role(uuid, text) TO waqfak_app;

CREATE OR REPLACE FUNCTION public.auth_revoke_session(sid uuid, reason text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE me uuid := public.app_current_user(); owner uuid;
BEGIN
  SELECT user_id INTO owner FROM public.sessions WHERE id = sid;
  IF owner IS NULL OR (owner <> me AND NOT public.app_holds('admin.users')) THEN RETURN false; END IF;
  UPDATE public.sessions SET revoked_at = now(), revoke_reason = reason WHERE id = sid AND revoked_at IS NULL;
  RETURN true;
END $$;
ALTER FUNCTION public.auth_revoke_session(uuid, text) OWNER TO waqfak_auth;
REVOKE ALL ON FUNCTION public.auth_revoke_session(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_revoke_session(uuid, text) TO waqfak_app;

CREATE OR REPLACE FUNCTION public.auth_delete_user(target uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE me uuid := public.app_current_user();
BEGIN
  IF NOT public.app_bound_mfa() OR NOT public.app_holds('admin.users') OR target = me THEN
    RAISE EXCEPTION 'auth_delete_user: a bound administrator (admin.users, second factor), not for themselves' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- the account's sessions end with it; the rest of its records follow the schema's own foreign keys
  UPDATE public.sessions SET revoked_at = now(), revoke_reason = 'account deleted' WHERE user_id = target AND revoked_at IS NULL;
  DELETE FROM public.user_roles WHERE user_id = target;
  DELETE FROM public.users WHERE id = target;
  RETURN FOUND;
END $$;
ALTER FUNCTION public.auth_delete_user(uuid) OWNER TO waqfak_auth;
REVOKE ALL ON FUNCTION public.auth_delete_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_delete_user(uuid) TO waqfak_app;

-- ── the system role: no table, one function per operation ───────────────────────────────────────────────────────────
-- (the pattern for share links, login, the queue: each operation a definer function that checks its own input)
CREATE OR REPLACE FUNCTION public.sys_view_share(lookup text) RETURNS TABLE (document_id uuid, title text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT d.id, d.title FROM public.document_shares s JOIN public.documents d ON d.id = s.document_id
   WHERE s.token_hash = lookup AND s.revoked_at IS NULL AND s.expires_at > now() AND s.uses < s.max_uses
$$;
ALTER FUNCTION public.sys_view_share(text) OWNER TO waqfak_auth;
REVOKE ALL ON FUNCTION public.sys_view_share(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sys_view_share(text) TO waqfak_system;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM waqfak_system;
