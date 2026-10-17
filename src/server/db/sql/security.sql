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
-- Request histories and messages are append-only for the application (corrections are new entries).
REVOKE UPDATE, DELETE, TRUNCATE ON request_item_events FROM waqfak_app;
REVOKE UPDATE, DELETE, TRUNCATE ON request_notes FROM waqfak_app;
REVOKE UPDATE, DELETE, TRUNCATE ON contract_signatures FROM waqfak_app;
-- Execution history and output versions are append-only too.
REVOKE UPDATE, DELETE, TRUNCATE ON task_events FROM waqfak_app;
REVOKE UPDATE, DELETE, TRUNCATE ON output_versions FROM waqfak_app;
REVOKE UPDATE, DELETE, TRUNCATE ON request_revisions FROM waqfak_app;

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
    ('projects',         'owner_user_id = app_current_user() OR created_by = app_current_user()'),
    ('request_items', 'EXISTS (SELECT 1 FROM service_requests r WHERE r.id = request_items.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user()))'),
    ('request_item_events', 'EXISTS (SELECT 1 FROM service_requests r WHERE r.id = request_item_events.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user()))'),
    ('quotes', 'EXISTS (SELECT 1 FROM service_requests r WHERE r.id = quotes.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user()))'),
    ('request_notes', 'EXISTS (SELECT 1 FROM service_requests r WHERE r.id = request_notes.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user()))'),
    ('request_events', 'EXISTS (SELECT 1 FROM service_requests r WHERE r.id = request_events.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user()))'),
    ('request_stages', 'EXISTS (SELECT 1 FROM service_requests r WHERE r.id = request_stages.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user()))'),
    ('deliverables', 'EXISTS (SELECT 1 FROM service_requests r WHERE r.id = deliverables.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user()))'),
    ('request_links', 'EXISTS (SELECT 1 FROM service_requests r WHERE r.id = request_links.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user()))'),
    ('outputs', 'EXISTS (SELECT 1 FROM service_requests r WHERE r.id = outputs.request_id AND r.assigned_to_user_id = app_current_user())'),
    ('output_versions', 'EXISTS (SELECT 1 FROM service_requests r WHERE r.id = output_versions.request_id AND r.assigned_to_user_id = app_current_user())'),
    ('request_revisions', 'EXISTS (SELECT 1 FROM service_requests r WHERE r.id = request_revisions.request_id AND r.assigned_to_user_id = app_current_user())'),
    ('service_terms', 'EXISTS (SELECT 1 FROM service_requests r WHERE r.id = service_terms.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user()))'),
    ('service_cycles', 'EXISTS (SELECT 1 FROM service_requests r WHERE r.id = service_cycles.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user()))'),
    ('payment_schedule', 'EXISTS (SELECT 1 FROM service_requests r WHERE r.id = payment_schedule.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user()))'),
    ('task_events', 'EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_events.task_id AND (t.assignee_user_id = app_current_user() OR t.created_by = app_current_user()))')
  ) AS v(tbl, expr)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS nullwaqf_owner ON %I', p.tbl);
    EXECUTE format(
      'CREATE POLICY nullwaqf_owner ON %I AS RESTRICTIVE FOR ALL TO waqfak_app USING (waqf_id IS NOT NULL OR app_current_user() IS NULL OR app_has_global_access() OR %s) WITH CHECK (waqf_id IS NOT NULL OR app_current_user() IS NULL OR app_has_global_access() OR %s)',
      p.tbl, p.expr, p.expr);
  END LOOP;
END $$;

-- ───────────── Staff-only work records ─────────────
-- Output drafts and request execution history belong to the team: waqf members (clients) never read them, even with
-- access to the waqf. Clients receive an output only as the approved, delivered document.
CREATE OR REPLACE FUNCTION app_is_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT is_staff FROM users WHERE id = app_current_user()), false)
$$;
REVOKE ALL ON FUNCTION app_is_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_staff() TO waqfak_app;

DROP POLICY IF EXISTS staff_only ON outputs;
CREATE POLICY staff_only ON outputs AS RESTRICTIVE FOR ALL TO waqfak_app USING (app_current_user() IS NULL OR app_is_staff()) WITH CHECK (app_current_user() IS NULL OR app_is_staff());
DROP POLICY IF EXISTS staff_only ON output_versions;
CREATE POLICY staff_only ON output_versions AS RESTRICTIVE FOR ALL TO waqfak_app USING (app_current_user() IS NULL OR app_is_staff()) WITH CHECK (app_current_user() IS NULL OR app_is_staff());
DROP POLICY IF EXISTS staff_only ON task_events;
-- Platform rules running in a client's action (e.g. submission creates the intake task) may write events; only staff read them.
CREATE POLICY staff_only ON task_events AS RESTRICTIVE FOR SELECT TO waqfak_app USING (request_id IS NULL OR app_current_user() IS NULL OR app_is_staff());

-- Corrections and rollbacks of a request are team records.
DROP POLICY IF EXISTS staff_only ON request_revisions;
CREATE POLICY staff_only ON request_revisions AS RESTRICTIVE FOR ALL TO waqfak_app USING (app_current_user() IS NULL OR app_is_staff()) WITH CHECK (app_current_user() IS NULL OR app_is_staff());

-- An invoice exists for the client only once it is sent: drafts and approved-but-unsent invoices are team records.
DROP POLICY IF EXISTS unsent_staff_only ON invoices;
CREATE POLICY unsent_staff_only ON invoices AS RESTRICTIVE FOR SELECT TO waqfak_app USING (status NOT IN ('draft', 'approved') OR app_current_user() IS NULL OR app_is_staff());


-- Continuous services: the client reads a delivery cycle only once it was made available to them (its preparation,
-- checklist and review stay with the team). The client's only writes are its decision and the «viewed» mark on a cycle
-- already made available (enforced in the server actions); terms are written by staff only.
DROP POLICY IF EXISTS sent_or_staff ON service_cycles;
CREATE POLICY sent_or_staff ON service_cycles AS RESTRICTIVE FOR ALL TO waqfak_app
  USING (sent_at IS NOT NULL OR app_current_user() IS NULL OR app_is_staff()) WITH CHECK (sent_at IS NOT NULL OR app_current_user() IS NULL OR app_is_staff());
DROP POLICY IF EXISTS staff_write ON service_terms;
CREATE POLICY staff_write ON service_terms AS RESTRICTIVE FOR ALL TO waqfak_app
  USING (true) WITH CHECK (app_current_user() IS NULL OR app_is_staff());

-- Payment schedule: created when a contract is executed (by whichever party signs last); changed by staff only.
DROP POLICY IF EXISTS staff_update ON payment_schedule;
CREATE POLICY staff_update ON payment_schedule AS RESTRICTIVE FOR UPDATE TO waqfak_app
  USING (app_current_user() IS NULL OR app_is_staff()) WITH CHECK (app_current_user() IS NULL OR app_is_staff());
DROP POLICY IF EXISTS staff_delete ON payment_schedule;
CREATE POLICY staff_delete ON payment_schedule AS RESTRICTIVE FOR DELETE TO waqfak_app USING (app_current_user() IS NULL OR app_is_staff());

-- ───────────── Output quality: conflicts, specialist findings, official documentation ─────────────
-- Team records: clients never read conflicts, findings or the review trail (they receive the approved document only).
REVOKE UPDATE, DELETE, TRUNCATE ON output_reviews FROM waqfak_app;
REVOKE UPDATE, DELETE, TRUNCATE ON output_official_records FROM waqfak_app;
REVOKE DELETE, TRUNCATE ON data_conflicts FROM waqfak_app;
DROP POLICY IF EXISTS staff_only ON data_conflicts;
CREATE POLICY staff_only ON data_conflicts AS RESTRICTIVE FOR ALL TO waqfak_app USING (app_current_user() IS NULL OR app_is_staff()) WITH CHECK (app_current_user() IS NULL OR app_is_staff());
DROP POLICY IF EXISTS staff_only ON output_reviews;
CREATE POLICY staff_only ON output_reviews AS RESTRICTIVE FOR ALL TO waqfak_app USING (app_current_user() IS NULL OR app_is_staff()) WITH CHECK (app_current_user() IS NULL OR app_is_staff());
DROP POLICY IF EXISTS staff_only ON output_official_records;
CREATE POLICY staff_only ON output_official_records AS RESTRICTIVE FOR ALL TO waqfak_app USING (app_current_user() IS NULL OR app_is_staff()) WITH CHECK (app_current_user() IS NULL OR app_is_staff());
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN SELECT * FROM (VALUES
    ('data_conflicts', 'EXISTS (SELECT 1 FROM service_requests r WHERE r.id = data_conflicts.request_id AND r.assigned_to_user_id = app_current_user())'),
    ('output_reviews', 'EXISTS (SELECT 1 FROM service_requests r WHERE r.id = output_reviews.request_id AND r.assigned_to_user_id = app_current_user())'),
    ('output_official_records', 'EXISTS (SELECT 1 FROM service_requests r WHERE r.id = output_official_records.request_id AND r.assigned_to_user_id = app_current_user())')
  ) AS v(tbl, expr)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS nullwaqf_owner ON %I', p.tbl);
    EXECUTE format(
      'CREATE POLICY nullwaqf_owner ON %I AS RESTRICTIVE FOR ALL TO waqfak_app USING (waqf_id IS NOT NULL OR app_current_user() IS NULL OR app_has_global_access() OR %s) WITH CHECK (waqf_id IS NOT NULL OR app_current_user() IS NULL OR app_has_global_access() OR %s)',
      p.tbl, p.expr, p.expr);
  END LOOP;
END $$;
-- One open record per conflict of a request (a conflict that returns after resolution is a new row).
CREATE UNIQUE INDEX IF NOT EXISTS data_conflicts_open_uq ON data_conflicts (request_id, conflict_key) WHERE status = 'open';

-- Guard on output transitions, independent of the application: an output is not sent for review or approved while its
-- current version has blocking gaps, unwritten specialist parts, failed checks, or the request has an open material
-- conflict; it is not approved while a check that needs a specialist has no finding on that version.
CREATE OR REPLACE FUNCTION guard_output_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v record;
  n int;
BEGIN
  -- a version under review or approved is not swapped underneath its reviewer or approver
  IF OLD.status IN ('in_review', 'approved') AND NEW.status = OLD.status AND NEW.current_version IS DISTINCT FROM OLD.current_version THEN
    RAISE EXCEPTION 'output_guard: version changed while %', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status NOT IN ('in_review', 'approved') OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  SELECT gaps, sections INTO v FROM output_versions WHERE output_id = NEW.id AND version = NEW.current_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'output_guard: no current version' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_path_exists(v.gaps, '$[*] ? (@.severity == "blocking")') THEN
    RAISE EXCEPTION 'output_guard: blocking gaps on version %', NEW.current_version USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_path_exists(v.sections, '$[*] ? (!(exists(@.removed)) || @.removed != true).blocks[*] ? (@.type == "specialist" && @.text like_regex "^\\s*$")') THEN
    RAISE EXCEPTION 'output_guard: unwritten specialist parts' USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO n FROM data_conflicts WHERE request_id = NEW.request_id AND status = 'open' AND severity = 'material';
  IF n > 0 THEN
    RAISE EXCEPTION 'output_guard: % open material conflict(s)', n USING ERRCODE = 'check_violation';
  END IF;
  -- checks: latest finding per check on this version
  WITH items AS (
    SELECT i->>'key' AS key, i->>'status' AS status
    FROM jsonb_path_query(v.sections, '$[*].blocks[*] ? (@.type == "checks").items[*]') AS i
  ), latest AS (
    SELECT DISTINCT ON (target_key) target_key, status FROM output_reviews
    WHERE output_id = NEW.id AND version = NEW.current_version AND kind = 'check' ORDER BY target_key, created_at DESC
  )
  SELECT count(*) INTO n FROM items LEFT JOIN latest l ON l.target_key = items.key
  WHERE items.status = 'failed'
     OR l.status = 'failed'
     OR (NEW.status = 'approved' AND items.status = 'specialist' AND l.status IS NULL);
  IF n > 0 THEN
    RAISE EXCEPTION 'output_guard: % check(s) failed or awaiting a specialist finding', n USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS outputs_transition_guard ON outputs;
CREATE TRIGGER outputs_transition_guard BEFORE UPDATE OF status, current_version ON outputs
  FOR EACH ROW EXECUTE FUNCTION guard_output_transition();

-- ───────────── Field-level review of requests ─────────────
-- Clients read the review state of their request's fields (e.g. «approved by the team»); only staff write it.
DROP POLICY IF EXISTS nullwaqf_owner ON request_field_states;
CREATE POLICY nullwaqf_owner ON request_field_states AS RESTRICTIVE FOR ALL TO waqfak_app
  USING (waqf_id IS NOT NULL OR app_current_user() IS NULL OR app_has_global_access() OR EXISTS (SELECT 1 FROM service_requests r WHERE r.id = request_field_states.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user())))
  WITH CHECK (waqf_id IS NOT NULL OR app_current_user() IS NULL OR app_has_global_access() OR EXISTS (SELECT 1 FROM service_requests r WHERE r.id = request_field_states.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user())));
DROP POLICY IF EXISTS staff_insert ON request_field_states;
CREATE POLICY staff_insert ON request_field_states AS RESTRICTIVE FOR INSERT TO waqfak_app WITH CHECK (app_current_user() IS NULL OR app_is_staff());
DROP POLICY IF EXISTS staff_update ON request_field_states;
CREATE POLICY staff_update ON request_field_states AS RESTRICTIVE FOR UPDATE TO waqfak_app USING (app_current_user() IS NULL OR app_is_staff()) WITH CHECK (app_current_user() IS NULL OR app_is_staff());
REVOKE DELETE, TRUNCATE ON request_field_states FROM waqfak_app;
