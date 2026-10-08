-- Waqfak database security layer (idempotent). Applied by the owner role after schema migrations.
-- Defense in depth: the application enforces RBAC+ABAC; PostgreSQL enforces waqf-level isolation (RLS)
-- so that a bug in application code cannot leak another waqf's rows.

-- Roles (waqfak_owner, waqfak_app, waqfak_mlro) are created once by a DBA: see scripts/db-bootstrap.sql

-- ───────────── Context helpers (set per transaction by the app with set_config(..., true)) ─────────────
CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_has_global_access() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.global_access', true), 'off') = 'on'
$$;

-- SECURITY DEFINER so it can read memberships without recursing into their own policies.
CREATE OR REPLACE FUNCTION app_can_access_waqf(w uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    w IS NULL
    OR app_has_global_access()
    OR EXISTS (
      SELECT 1 FROM waqf_memberships m
      WHERE m.waqf_id = w AND m.user_id = app_current_user() AND m.status = 'active'
        AND (m.ends_at IS NULL OR m.ends_at > now())
    )
    OR EXISTS (
      SELECT 1 FROM service_requests r
      WHERE r.waqf_id = w AND r.assigned_to_user_id = app_current_user()
        AND r.status NOT IN ('closed', 'cancelled', 'rejected')
    )
    OR EXISTS (
      SELECT 1 FROM delegations d
      WHERE d.waqf_id = w AND d.agent_user_id = app_current_user() AND d.status = 'active'
        AND current_date BETWEEN d.valid_from AND d.valid_to
    )
    OR EXISTS (
      SELECT 1 FROM break_glass_access b
      WHERE b.waqf_id = w AND b.user_id = app_current_user() AND b.status = 'approved' AND b.expires_at > now()
    )
$$;

CREATE OR REPLACE FUNCTION app_waqf_has_members(w uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM waqf_memberships WHERE waqf_id = w)
$$;

REVOKE ALL ON FUNCTION app_can_access_waqf(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_waqf_has_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_access_waqf(uuid), app_waqf_has_members(uuid), app_current_user(), app_has_global_access() TO waqfak_app;

-- ───────────── Grants ─────────────
GRANT USAGE ON SCHEMA public TO waqfak_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO waqfak_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO waqfak_app;

-- Audit log is append-only for the application.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM waqfak_app;
REVOKE UPDATE, DELETE, TRUNCATE ON document_access_log FROM waqfak_app;

-- Restricted schema: only reachable after SET LOCAL ROLE waqfak_mlro (done by the app for the MLRO role).
REVOKE ALL ON SCHEMA restricted FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA restricted FROM waqfak_app;
GRANT USAGE ON SCHEMA restricted TO waqfak_mlro;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA restricted TO waqfak_mlro;

-- ───────────── Row-level security on every waqf-scoped table ─────────────
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'waqf_id' AND tb.table_type = 'BASE TABLE'
      AND c.table_name NOT IN ('waqf_memberships')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('DROP POLICY IF EXISTS waqf_isolation ON %I', t.table_name);
    EXECUTE format(
      'CREATE POLICY waqf_isolation ON %I FOR ALL TO waqfak_app USING (app_can_access_waqf(waqf_id)) WITH CHECK (app_can_access_waqf(waqf_id))',
      t.table_name);
  END LOOP;
END $$;

-- waqfs: rows keyed by id. Any authenticated user may create a waqf; visibility requires access.
ALTER TABLE waqfs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS waqf_select ON waqfs;
DROP POLICY IF EXISTS waqf_insert ON waqfs;
DROP POLICY IF EXISTS waqf_update ON waqfs;
DROP POLICY IF EXISTS waqf_delete ON waqfs;
CREATE POLICY waqf_select ON waqfs FOR SELECT TO waqfak_app USING (app_can_access_waqf(id) OR NOT app_waqf_has_members(id) AND created_by = app_current_user());
CREATE POLICY waqf_insert ON waqfs FOR INSERT TO waqfak_app WITH CHECK (app_current_user() IS NOT NULL OR app_has_global_access());
CREATE POLICY waqf_update ON waqfs FOR UPDATE TO waqfak_app USING (app_can_access_waqf(id)) WITH CHECK (app_can_access_waqf(id));
CREATE POLICY waqf_delete ON waqfs FOR DELETE TO waqfak_app USING (app_has_global_access());

-- memberships: a user always sees their own memberships; the first member of a new waqf can be created by its creator.
ALTER TABLE waqf_memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wm_select ON waqf_memberships;
DROP POLICY IF EXISTS wm_write ON waqf_memberships;
DROP POLICY IF EXISTS wm_insert ON waqf_memberships;
DROP POLICY IF EXISTS wm_update ON waqf_memberships;
DROP POLICY IF EXISTS wm_delete ON waqf_memberships;
CREATE POLICY wm_select ON waqf_memberships FOR SELECT TO waqfak_app
  USING (user_id = app_current_user() OR app_can_access_waqf(waqf_id));
CREATE POLICY wm_insert ON waqf_memberships FOR INSERT TO waqfak_app
  WITH CHECK (app_can_access_waqf(waqf_id) OR NOT app_waqf_has_members(waqf_id));
CREATE POLICY wm_update ON waqf_memberships FOR UPDATE TO waqfak_app
  USING (app_can_access_waqf(waqf_id)) WITH CHECK (app_can_access_waqf(waqf_id));
CREATE POLICY wm_delete ON waqf_memberships FOR DELETE TO waqfak_app USING (app_has_global_access());

-- waqf_keys are created right after the waqf (before memberships exist).
DROP POLICY IF EXISTS waqf_isolation ON waqf_keys;
CREATE POLICY waqf_isolation ON waqf_keys FOR ALL TO waqfak_app
  USING (app_can_access_waqf(waqf_id))
  WITH CHECK (app_can_access_waqf(waqf_id) OR NOT app_waqf_has_members(waqf_id));

-- Append-only protection independent of grants.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: % is not allowed on %', TG_OP, TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Locked minutes cannot be edited.
CREATE OR REPLACE FUNCTION protect_locked_minutes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'locked' THEN
    RAISE EXCEPTION 'minutes are locked; create a new version instead';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS minutes_lock ON minutes;
CREATE TRIGGER minutes_lock BEFORE UPDATE OR DELETE ON minutes
  FOR EACH ROW EXECUTE FUNCTION protect_locked_minutes();

-- notifications are personal: even rows without a waqf are visible only to their recipient (system context excepted).
DROP POLICY IF EXISTS notif_owner_sel ON notifications;
DROP POLICY IF EXISTS notif_owner_upd ON notifications;
DROP POLICY IF EXISTS notif_owner_del ON notifications;
CREATE POLICY notif_owner_sel ON notifications AS RESTRICTIVE FOR SELECT TO waqfak_app USING (app_current_user() IS NULL OR user_id = app_current_user());
CREATE POLICY notif_owner_upd ON notifications AS RESTRICTIVE FOR UPDATE TO waqfak_app USING (app_current_user() IS NULL OR user_id = app_current_user());
CREATE POLICY notif_owner_del ON notifications AS RESTRICTIVE FOR DELETE TO waqfak_app USING (app_current_user() IS NULL OR user_id = app_current_user());

-- Audit chain head, read outside the caller's RLS view (writers hold advisory lock 724501).
CREATE OR REPLACE FUNCTION app_audit_last_hash() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION app_audit_last_hash() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_audit_last_hash() TO waqfak_app;

-- Break-glass: a staff member can see and file their own requests (approval stays with approvers via global access).
DROP POLICY IF EXISTS bga_own_select ON break_glass_access;
DROP POLICY IF EXISTS bga_own_insert ON break_glass_access;
CREATE POLICY bga_own_select ON break_glass_access FOR SELECT TO waqfak_app USING (user_id = app_current_user());
CREATE POLICY bga_own_insert ON break_glass_access FOR INSERT TO waqfak_app WITH CHECK (user_id = app_current_user() AND status = 'requested');

-- ───────────── Rows without a waqf (personal / request-only) ─────────────
-- app_can_access_waqf(NULL) is true, so waqf_isolation alone would expose such rows to every signed-in user.
-- These RESTRICTIVE policies add an owner check for null-waqf rows (system context and global-access staff excepted).
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN SELECT * FROM (VALUES
    ('assessments',      'user_id IS NULL OR user_id = app_current_user()'),
    ('ai_interactions',  'user_id = app_current_user()'),
    ('service_requests', 'requester_user_id = app_current_user() OR assigned_to_user_id = app_current_user() OR created_by = app_current_user()'),
    ('documents',        'owner_user_id = app_current_user() OR created_by = app_current_user() OR EXISTS (SELECT 1 FROM service_requests r WHERE r.id = documents.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user()))'),
    ('invoices',         'user_id = app_current_user() OR created_by = app_current_user() OR EXISTS (SELECT 1 FROM service_requests r WHERE r.id = invoices.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user()))'),
    ('contracts',        'party_user_id = app_current_user() OR created_by = app_current_user() OR EXISTS (SELECT 1 FROM service_requests r WHERE r.id = contracts.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user()))'),
    ('tasks',            'assignee_user_id = app_current_user() OR created_by = app_current_user() OR EXISTS (SELECT 1 FROM service_requests r WHERE r.id = tasks.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user()))'),
    ('subscriptions',    'user_id = app_current_user() OR created_by = app_current_user()'),
    ('projects',         'owner_user_id = app_current_user() OR created_by = app_current_user()')
  ) AS v(tbl, expr)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS nullwaqf_owner ON %I', p.tbl);
    EXECUTE format(
      'CREATE POLICY nullwaqf_owner ON %I AS RESTRICTIVE FOR ALL TO waqfak_app USING (waqf_id IS NOT NULL OR app_current_user() IS NULL OR app_has_global_access() OR %s) WITH CHECK (waqf_id IS NOT NULL OR app_current_user() IS NULL OR app_has_global_access() OR %s)',
      p.tbl, p.expr, p.expr);
  END LOOP;
END $$;
