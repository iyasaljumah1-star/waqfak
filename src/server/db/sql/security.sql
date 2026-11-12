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

-- Stage 11: «the system» is a connection that is neither the application's nor the authentication's and declares no
-- person — the owner (migrations, seed) and the system role (jobs, public reads). The application role is never the
-- system: unbound, it is an anonymous visitor (redefined with the binding at the end of this file).
CREATE OR REPLACE FUNCTION app_is_system() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT session_user NOT IN ('waqfak_app', 'waqfak_auth') AND NULLIF(current_setting('app.user_id', true), '') IS NULL
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
GRANT EXECUTE ON FUNCTION app_can_access_waqf(uuid), app_waqf_has_members(uuid), app_current_user(), app_has_global_access(), app_is_system() TO waqfak_app;

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
CREATE POLICY waqf_insert ON waqfs FOR INSERT TO waqfak_app WITH CHECK (NOT app_is_system() OR app_has_global_access());
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
CREATE POLICY notif_owner_sel ON notifications AS RESTRICTIVE FOR SELECT TO waqfak_app USING (app_is_system() OR user_id = app_current_user());
CREATE POLICY notif_owner_upd ON notifications AS RESTRICTIVE FOR UPDATE TO waqfak_app USING (app_is_system() OR user_id = app_current_user());
CREATE POLICY notif_owner_del ON notifications AS RESTRICTIVE FOR DELETE TO waqfak_app USING (app_is_system() OR user_id = app_current_user());

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
      'CREATE POLICY nullwaqf_owner ON %I AS RESTRICTIVE FOR ALL TO waqfak_app USING (waqf_id IS NOT NULL OR app_is_system() OR app_has_global_access() OR %s) WITH CHECK (waqf_id IS NOT NULL OR app_is_system() OR app_has_global_access() OR %s)',
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
CREATE POLICY staff_only ON outputs AS RESTRICTIVE FOR ALL TO waqfak_app USING (app_is_system() OR app_is_staff()) WITH CHECK (app_is_system() OR app_is_staff());
DROP POLICY IF EXISTS staff_only ON output_versions;
CREATE POLICY staff_only ON output_versions AS RESTRICTIVE FOR ALL TO waqfak_app USING (app_is_system() OR app_is_staff()) WITH CHECK (app_is_system() OR app_is_staff());
DROP POLICY IF EXISTS staff_only ON task_events;
-- Platform rules running in a client's action (e.g. submission creates the intake task) may write events; only staff read them.
CREATE POLICY staff_only ON task_events AS RESTRICTIVE FOR SELECT TO waqfak_app USING (request_id IS NULL OR app_is_system() OR app_is_staff());

-- ───────────── Processing engine and the final approval (owner's order of 2026-11-01, phase 2) ─────────────
-- Nothing of an output reaches the client before the system administrator's final approval, whatever the route.
-- The processing record (jobs, runs, steps) belongs to the team.
DROP POLICY IF EXISTS staff_only ON processing_runs;
CREATE POLICY staff_only ON processing_runs AS RESTRICTIVE FOR ALL TO waqfak_app USING (app_is_system() OR app_is_staff()) WITH CHECK (app_is_system() OR app_is_staff());
DROP POLICY IF EXISTS staff_only ON processing_steps;
CREATE POLICY staff_only ON processing_steps AS RESTRICTIVE FOR ALL TO waqfak_app USING (app_is_system() OR app_is_staff()) WITH CHECK (app_is_system() OR app_is_staff());
-- The client's submission queues the first job (written in the client's transaction); only staff read the queue.
DROP POLICY IF EXISTS staff_only ON processing_jobs;
CREATE POLICY staff_only ON processing_jobs AS RESTRICTIVE FOR SELECT TO waqfak_app USING (app_is_system() OR app_is_staff());
DROP POLICY IF EXISTS staff_update ON processing_jobs;
CREATE POLICY staff_update ON processing_jobs AS RESTRICTIVE FOR UPDATE TO waqfak_app USING (app_is_system() OR app_is_staff());
DROP POLICY IF EXISTS staff_delete ON processing_jobs;
CREATE POLICY staff_delete ON processing_jobs AS RESTRICTIVE FOR DELETE TO waqfak_app USING (app_is_system() OR app_is_staff());

-- A delivery record exists for the client only once released: a cycle delivery once sent (released_at), any other one
-- once the request reached the client's side (legacy manual flow: awaiting the client's approval, completed, closed).
DROP POLICY IF EXISTS released_or_staff ON deliverables;
CREATE POLICY released_or_staff ON deliverables AS RESTRICTIVE FOR SELECT TO waqfak_app USING (
  app_is_system() OR app_is_staff() OR released_at IS NOT NULL
  OR (cycle_id IS NULL AND status <> 'draft' AND EXISTS (
    SELECT 1 FROM service_requests r WHERE r.id = deliverables.request_id AND r.status IN ('awaiting_client_approval', 'completed', 'closed'))));

-- A deliverable file of a request is hidden from the client until it is approved (released), unless the client owns it.
DROP POLICY IF EXISTS unreleased_staff_only ON documents;
CREATE POLICY unreleased_staff_only ON documents AS RESTRICTIVE FOR SELECT TO waqfak_app USING (
  app_is_system() OR app_is_staff() OR owner_user_id = app_current_user()
  OR NOT (doc_type = 'deliverable' AND request_id IS NOT NULL AND approval_status IS DISTINCT FROM 'approved'));

-- Team-side events of a request (output preparation, approvals, engine steps) are never read by the client.
DROP POLICY IF EXISTS internal_staff_only ON request_events;
CREATE POLICY internal_staff_only ON request_events AS RESTRICTIVE FOR SELECT TO waqfak_app USING (
  internal = false OR app_is_system() OR app_is_staff());

-- Corrections and rollbacks of a request are team records.
DROP POLICY IF EXISTS staff_only ON request_revisions;
CREATE POLICY staff_only ON request_revisions AS RESTRICTIVE FOR ALL TO waqfak_app USING (app_is_system() OR app_is_staff()) WITH CHECK (app_is_system() OR app_is_staff());

-- An invoice exists for the client only once it is sent: drafts and approved-but-unsent invoices are team records.
DROP POLICY IF EXISTS unsent_staff_only ON invoices;
CREATE POLICY unsent_staff_only ON invoices AS RESTRICTIVE FOR SELECT TO waqfak_app USING (status NOT IN ('draft', 'approved') OR app_is_system() OR app_is_staff());


-- Continuous services: the client reads a delivery cycle only once it was made available to them (its preparation,
-- checklist and review stay with the team). The client's only writes are its decision and the «viewed» mark on a cycle
-- already made available (enforced in the server actions); terms are written by staff only.
DROP POLICY IF EXISTS sent_or_staff ON service_cycles;
CREATE POLICY sent_or_staff ON service_cycles AS RESTRICTIVE FOR ALL TO waqfak_app
  USING (sent_at IS NOT NULL OR app_is_system() OR app_is_staff()) WITH CHECK (sent_at IS NOT NULL OR app_is_system() OR app_is_staff());
DROP POLICY IF EXISTS staff_write ON service_terms;
CREATE POLICY staff_write ON service_terms AS RESTRICTIVE FOR ALL TO waqfak_app
  USING (true) WITH CHECK (app_is_system() OR app_is_staff());

-- Payment schedule: created when a contract is executed (by whichever party signs last); changed by staff only.
DROP POLICY IF EXISTS staff_update ON payment_schedule;
CREATE POLICY staff_update ON payment_schedule AS RESTRICTIVE FOR UPDATE TO waqfak_app
  USING (app_is_system() OR app_is_staff()) WITH CHECK (app_is_system() OR app_is_staff());
DROP POLICY IF EXISTS staff_delete ON payment_schedule;
CREATE POLICY staff_delete ON payment_schedule AS RESTRICTIVE FOR DELETE TO waqfak_app USING (app_is_system() OR app_is_staff());

-- ───────────── Output quality: conflicts, specialist findings, official documentation ─────────────
-- Team records: clients never read conflicts, findings or the review trail (they receive the approved document only).
REVOKE UPDATE, DELETE, TRUNCATE ON output_reviews FROM waqfak_app;
REVOKE UPDATE, DELETE, TRUNCATE ON output_official_records FROM waqfak_app;
REVOKE DELETE, TRUNCATE ON data_conflicts FROM waqfak_app;
DROP POLICY IF EXISTS staff_only ON data_conflicts;
CREATE POLICY staff_only ON data_conflicts AS RESTRICTIVE FOR ALL TO waqfak_app USING (app_is_system() OR app_is_staff()) WITH CHECK (app_is_system() OR app_is_staff());
DROP POLICY IF EXISTS staff_only ON output_reviews;
CREATE POLICY staff_only ON output_reviews AS RESTRICTIVE FOR ALL TO waqfak_app USING (app_is_system() OR app_is_staff()) WITH CHECK (app_is_system() OR app_is_staff());
DROP POLICY IF EXISTS staff_only ON output_official_records;
CREATE POLICY staff_only ON output_official_records AS RESTRICTIVE FOR ALL TO waqfak_app USING (app_is_system() OR app_is_staff()) WITH CHECK (app_is_system() OR app_is_staff());
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
      'CREATE POLICY nullwaqf_owner ON %I AS RESTRICTIVE FOR ALL TO waqfak_app USING (waqf_id IS NOT NULL OR app_is_system() OR app_has_global_access() OR %s) WITH CHECK (waqf_id IS NOT NULL OR app_is_system() OR app_has_global_access() OR %s)',
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
  -- engine-processed requests: the final approval belongs to holders of «outputs.final_approve» (system administrator),
  -- and never to the account that produced the version (the platform's processing account)
  IF NEW.status = 'approved' AND EXISTS (SELECT 1 FROM service_requests r WHERE r.id = NEW.request_id AND r.processing_mode = 'engine') THEN
    IF NEW.approved_by IS NULL OR NOT EXISTS (
      SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = NEW.approved_by AND p.key = 'outputs.final_approve') THEN
      RAISE EXCEPTION 'output_guard: final approval requires outputs.final_approve' USING ERRCODE = 'check_violation';
    END IF;
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
  USING (waqf_id IS NOT NULL OR app_is_system() OR app_has_global_access() OR EXISTS (SELECT 1 FROM service_requests r WHERE r.id = request_field_states.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user())))
  WITH CHECK (waqf_id IS NOT NULL OR app_is_system() OR app_has_global_access() OR EXISTS (SELECT 1 FROM service_requests r WHERE r.id = request_field_states.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user())));
DROP POLICY IF EXISTS staff_insert ON request_field_states;
CREATE POLICY staff_insert ON request_field_states AS RESTRICTIVE FOR INSERT TO waqfak_app WITH CHECK (app_is_system() OR app_is_staff());
DROP POLICY IF EXISTS staff_update ON request_field_states;
CREATE POLICY staff_update ON request_field_states AS RESTRICTIVE FOR UPDATE TO waqfak_app USING (app_is_system() OR app_is_staff()) WITH CHECK (app_is_system() OR app_is_staff());
REVOKE DELETE, TRUNCATE ON request_field_states FROM waqfak_app;

-- ───────────── Reference registry (phase 1): system context only; history append-only ─────────────
-- Nothing in the running application reads these tables yet. Reads and writes need the system/global context.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ref_sources','ref_versions','ref_version_confirmations','ref_units','ref_match_runs','ref_match_reviews','ref_fetch_attempts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS ref_system_only ON %I', t);
    EXECUTE format('CREATE POLICY ref_system_only ON %I FOR ALL TO waqfak_app USING (app_has_global_access()) WITH CHECK (app_has_global_access())', t);
  END LOOP;
END $$;

-- A stored text, its units, comparisons, reviews and retrieval attempts are never changed or removed, by anyone:
-- the trigger also binds the owner role, unlike a revoked privilege.
CREATE OR REPLACE FUNCTION ref_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %: % refused', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ref_versions','ref_version_confirmations','ref_units','ref_match_runs','ref_match_reviews','ref_fetch_attempts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS ref_append_only ON %I', t);
    EXECUTE format('CREATE TRIGGER ref_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ref_append_only()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS ref_no_truncate ON %I', t);
    EXECUTE format('CREATE TRIGGER ref_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION ref_append_only()', t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM waqfak_app', t);
  END LOOP;
END $$;

-- ───────────── Unified knowledge engine (2026-11-06): knowledge base read by the team, written by the system ─────────────
-- Reference texts carry no waqf data, but what the engine cites must not be altered from a user session: only the system
-- context (ingestion, the engine) writes; staff and the system read. Reviews of a source are append-only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['kb_sources','kb_chunks','kb_source_reviews'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS kb_read ON %I', t);
    EXECUTE format('CREATE POLICY kb_read ON %I FOR SELECT TO waqfak_app USING (app_has_global_access() OR app_is_system() OR app_is_staff())', t);
    EXECUTE format('DROP POLICY IF EXISTS kb_write ON %I', t);
    EXECUTE format('CREATE POLICY kb_write ON %I FOR ALL TO waqfak_app USING (app_has_global_access()) WITH CHECK (app_has_global_access())', t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS ref_append_only ON kb_source_reviews;
CREATE TRIGGER ref_append_only BEFORE UPDATE OR DELETE ON kb_source_reviews FOR EACH ROW EXECUTE FUNCTION ref_append_only();
DROP TRIGGER IF EXISTS ref_no_truncate ON kb_source_reviews;
CREATE TRIGGER ref_no_truncate BEFORE TRUNCATE ON kb_source_reviews FOR EACH STATEMENT EXECUTE FUNCTION ref_append_only();
REVOKE UPDATE, DELETE, TRUNCATE ON kb_source_reviews FROM waqfak_app;

-- Hardening after the independent review (2026-11-06): what the engine cites is never edited in place. A passage is
-- never updated or deleted; a source row may only be marked superseded (and keep engine-core's legacy status column);
-- any other correction is a new version. Binds the owner role too (trigger, not a privilege).
CREATE OR REPLACE FUNCTION kb_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'kb_sources: delete refused (sources are kept; a new version supersedes them)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - 'superseded_at' - 'verification_status') IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_at' - 'verification_status') THEN
    RAISE EXCEPTION 'kb_sources: only superseded_at may change; load a new version instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kb_source_guard ON kb_sources;
CREATE TRIGGER kb_source_guard BEFORE UPDATE OR DELETE ON kb_sources FOR EACH ROW EXECUTE FUNCTION kb_source_guard();
DROP TRIGGER IF EXISTS ref_append_only ON kb_chunks;
CREATE TRIGGER ref_append_only BEFORE UPDATE OR DELETE ON kb_chunks FOR EACH ROW EXECUTE FUNCTION ref_append_only();
DROP TRIGGER IF EXISTS ref_no_truncate ON kb_chunks;
CREATE TRIGGER ref_no_truncate BEFORE TRUNCATE ON kb_chunks FOR EACH STATEMENT EXECUTE FUNCTION ref_append_only();

-- A source review counts only if its author may give it: an active, unlocked user holding the permission
-- «knowledge.review.<field>» for the field the review declares (independent review N3). Checked at insertion.
CREATE OR REPLACE FUNCTION kb_review_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.reviewer_user_id AND u.status = 'active' AND (u.locked_until IS NULL OR u.locked_until < now())) THEN
    RAISE EXCEPTION 'kb_source_reviews: reviewer is not an active user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
                 WHERE ur.user_id = NEW.reviewer_user_id AND p.key = 'knowledge.review.' || NEW.reviewer_role) THEN
    RAISE EXCEPTION 'kb_source_reviews: reviewer lacks knowledge.review.%', NEW.reviewer_role USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kb_review_authority ON kb_source_reviews;
CREATE TRIGGER kb_review_authority BEFORE INSERT ON kb_source_reviews FOR EACH ROW EXECUTE FUNCTION kb_review_authority();

-- A review is recorded by its author, in the author's own session: no one records a review on another's behalf, and a
-- system context (seed, scripts, the engine) cannot record one at all (owner's order 2026-11-06, §2.3).
CREATE OR REPLACE FUNCTION kb_review_actor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF app_current_user() IS NULL OR app_current_user() <> NEW.reviewer_user_id THEN
    RAISE EXCEPTION 'kb_source_reviews: a review is recorded only by the reviewer, in the reviewer''s own session' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kb_review_actor ON kb_source_reviews;
CREATE TRIGGER kb_review_actor BEFORE INSERT ON kb_source_reviews FOR EACH ROW EXECUTE FUNCTION kb_review_actor();

-- Every review has its entry in the hash-chained, append-only audit trail (action «knowledge.review.recorded», entity
-- the review's id), written in the same transaction: a review without its audit entry cannot be committed.
CREATE OR REPLACE FUNCTION kb_review_audited() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.action = 'knowledge.review.recorded' AND a.entity_type = 'kb_source_review'
                 AND a.entity_id = NEW.id::text AND a.actor_user_id = NEW.reviewer_user_id) THEN
    RAISE EXCEPTION 'kb_source_reviews: review % has no audit entry', NEW.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS kb_review_audited ON kb_source_reviews;
CREATE CONSTRAINT TRIGGER kb_review_audited AFTER INSERT ON kb_source_reviews DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION kb_review_audited();
-- A reviewer (staff, not necessarily with global access) inserts their own reviews; the triggers above check the rest.
DROP POLICY IF EXISTS kb_review_insert ON kb_source_reviews;
CREATE POLICY kb_review_insert ON kb_source_reviews FOR INSERT TO waqfak_app WITH CHECK (reviewer_user_id = app_current_user() AND app_is_staff());

-- The same for the acceptance of a registry comparison (ref_match_reviews): only an active, unlocked holder of
-- «knowledge.review.legal», in their own session, with the audit entry. A rejection lowers nothing's standing and may
-- still be stored by the system context (phase-1 storage tests), but is audited when it comes from a person.
CREATE OR REPLACE FUNCTION ref_review_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.decision = 'accepted' THEN
    IF app_current_user() IS NULL OR app_current_user() <> NEW.reviewer_user_id THEN
      RAISE EXCEPTION 'ref_match_reviews: an acceptance is recorded only by the reviewer, in the reviewer''s own session' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.reviewer_user_id AND u.status = 'active' AND (u.locked_until IS NULL OR u.locked_until < now())) THEN
      RAISE EXCEPTION 'ref_match_reviews: reviewer is not an active user' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
                   WHERE ur.user_id = NEW.reviewer_user_id AND p.key = 'knowledge.review.legal') THEN
      RAISE EXCEPTION 'ref_match_reviews: reviewer lacks knowledge.review.legal' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ref_review_authority ON ref_match_reviews;
CREATE TRIGGER ref_review_authority BEFORE INSERT ON ref_match_reviews FOR EACH ROW EXECUTE FUNCTION ref_review_authority();

CREATE OR REPLACE FUNCTION ref_review_audited() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.decision = 'accepted' AND NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.action = 'knowledge.review.recorded' AND a.entity_type = 'ref_match_review'
                 AND a.entity_id = NEW.id::text AND a.actor_user_id = NEW.reviewer_user_id) THEN
    RAISE EXCEPTION 'ref_match_reviews: acceptance % has no audit entry', NEW.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ref_review_audited ON ref_match_reviews;
CREATE CONSTRAINT TRIGGER ref_review_audited AFTER INSERT ON ref_match_reviews DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ref_review_audited();
DROP POLICY IF EXISTS ref_review_insert ON ref_match_reviews;
CREATE POLICY ref_review_insert ON ref_match_reviews FOR INSERT TO waqfak_app WITH CHECK (reviewer_user_id = app_current_user() AND app_is_staff());

-- Read-time proof that a review was audited (the engine reads in the system context; audit_logs is not exposed).
DROP FUNCTION IF EXISTS knowledge_audited_reviews(text, uuid[]);
-- returns the audit entries themselves, so that the reader recomputes each entry's hash (a forged entry fails: R1d)
CREATE OR REPLACE FUNCTION knowledge_audited_reviews(kind text, ids uuid[])
  RETURNS TABLE (id bigint, at timestamptz, actor_user_id uuid, action text, entity_type text, entity_id text, waqf_id uuid, before jsonb, after jsonb, prev_hash text, hash text, actor_roles text[])
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.at, a.actor_user_id, a.action, a.entity_type, a.entity_id, a.waqf_id, a.before, a.after, a.prev_hash, a.hash, a.actor_roles FROM audit_logs a
  WHERE a.action = 'knowledge.review.recorded' AND a.entity_type = kind AND a.entity_id = ANY (SELECT x::text FROM unnest(ids) x)
$$;
REVOKE ALL ON FUNCTION knowledge_audited_reviews(text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION knowledge_audited_reviews(text, uuid[]) TO waqfak_app;

-- Independent review, round 4 (2026-11-06).
-- R5: a review concerns the current version of a source, and a passage of that same source.
CREATE OR REPLACE FUNCTION kb_review_target() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM kb_sources s WHERE s.id = NEW.source_id AND s.superseded_at IS NULL) THEN
    RAISE EXCEPTION 'kb_source_reviews: the source is not current (review the current version)' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.chunk_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM kb_chunks c WHERE c.id = NEW.chunk_id AND c.source_id = NEW.source_id) THEN
    RAISE EXCEPTION 'kb_source_reviews: the passage is not of this source' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kb_review_target ON kb_source_reviews;
CREATE TRIGGER kb_review_target BEFORE INSERT ON kb_source_reviews FOR EACH ROW EXECUTE FUNCTION kb_review_target();

-- R1d: the audit trail is one chain. Every entry must name, as its previous hash, the hash of the entry before it
-- (writers hold advisory lock 724501): an entry inserted out of the chain is refused, so a forged entry cannot sit
-- beside the chain unseen — and the verifier recomputes every hash.
CREATE OR REPLACE FUNCTION audit_chain_link() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE last text;
BEGIN
  -- the trigger takes the writers' lock itself, so a writer that skipped it cannot fork the chain (N5-3)
  PERFORM pg_advisory_xact_lock(724501);
  SELECT hash INTO last FROM audit_logs ORDER BY id DESC LIMIT 1;
  IF NEW.prev_hash IS DISTINCT FROM coalesce(last, 'GENESIS') THEN
    RAISE EXCEPTION 'audit_logs: entry does not continue the chain (prev_hash %, last %)', NEW.prev_hash, coalesce(last, 'GENESIS') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_chain_link ON audit_logs;
CREATE TRIGGER audit_chain_link BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_chain_link();

-- R4b: from a user session, roles and role permissions change only by a holder of «admin.roles», and no one gives
-- themselves a reviewer's permission (a reviewer is named by someone else). The system context (seed) is unaffected.
CREATE OR REPLACE FUNCTION app_holds(perm text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
                 JOIN users u ON u.id = ur.user_id
                 WHERE ur.user_id = app_current_user() AND p.key = perm AND u.status = 'active' AND (u.locked_until IS NULL OR u.locked_until < now()))
$$;
REVOKE ALL ON FUNCTION app_holds(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_holds(text) TO waqfak_app;

CREATE OR REPLACE FUNCTION user_roles_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF app_is_system() THEN RETURN coalesce(NEW, OLD); END IF;
  IF NOT app_holds('admin.roles') THEN
    RAISE EXCEPTION 'user_roles: changing roles needs admin.roles' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    r := NEW;
    IF r.user_id = app_current_user() AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.role_id AND p.key LIKE 'knowledge.review.%') THEN
      RAISE EXCEPTION 'user_roles: no one gives themselves a reviewer role' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS user_roles_guard ON user_roles;
CREATE TRIGGER user_roles_guard BEFORE INSERT OR UPDATE OR DELETE ON user_roles FOR EACH ROW EXECUTE FUNCTION user_roles_guard();

CREATE OR REPLACE FUNCTION role_permissions_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app_is_system() THEN RETURN coalesce(NEW, OLD); END IF;
  IF NOT app_holds('admin.roles') THEN
    RAISE EXCEPTION 'role_permissions: changing permissions needs admin.roles' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM permissions p WHERE p.id = NEW.permission_id AND p.key LIKE 'knowledge.review.%')
     AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.role_id = NEW.role_id AND ur.user_id = app_current_user()) THEN
    RAISE EXCEPTION 'role_permissions: no one gives a reviewer permission to a role they hold' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS role_permissions_guard ON role_permissions;
CREATE TRIGGER role_permissions_guard BEFORE INSERT OR UPDATE OR DELETE ON role_permissions FOR EACH ROW EXECUTE FUNCTION role_permissions_guard();

-- Independent review, round 5 (2026-11-06).
-- N5-1: the permissions catalog is the code's (authz/catalog.ts, seeded in the system context): no user session adds,
-- renames or removes a permission (renaming one held into «knowledge.review.*» or «admin.roles» would grant it).
CREATE OR REPLACE FUNCTION permissions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT app_is_system() THEN
    RAISE EXCEPTION 'permissions: the permission catalog is changed only by the system (seed)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS permissions_guard ON permissions;
CREATE TRIGGER permissions_guard BEFORE INSERT OR UPDATE OR DELETE ON permissions FOR EACH ROW EXECUTE FUNCTION permissions_guard();

-- N5-4: from their own session, a user does not lift their own lock, unlock or reactivate their own account, or make
-- themselves staff (an administrator does it for others, audited).
CREATE OR REPLACE FUNCTION users_self_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT app_is_system() AND app_current_user() = OLD.id THEN
    IF NEW.locked_until IS DISTINCT FROM OLD.locked_until AND (NEW.locked_until IS NULL OR NEW.locked_until < coalesce(OLD.locked_until, '-infinity')) THEN
      RAISE EXCEPTION 'users: an account does not lift its own lock' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.is_staff AND NOT OLD.is_staff THEN
      RAISE EXCEPTION 'users: an account does not make itself staff' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.status = 'locked' AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'users: a locked account does not change its own status' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_self_guard ON users;
CREATE TRIGGER users_self_guard BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION users_self_guard();

-- ═════════════ Owner's order of 2026-11-07 ═════════════
-- N5-1 (by privilege, not by a session variable): the permission catalog and the list of roles are the code's, written
-- by the seed with the owner role. The application role cannot insert, change or remove a permission or a role at all —
-- whatever app.user_id says (a session variable any connection of the role can set).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON permissions FROM waqfak_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON roles FROM waqfak_app;

-- N5-2 / R2: a review is bound to a real authenticated session. The request carries its session token (the cookie's
-- value) in app.session_token, for the review's own transaction only; the database hashes it and requires a session of
-- the reviewer that exists, is not revoked, has not expired, passed the second factor, and belongs to a staff account.
-- The session row stores only the token's hash: a connection that knows a reviewer's id — or even the hash — cannot
-- produce the token. The session found is written on the review (session_id), whatever the inserter supplied.
-- (Round 7: session rows store the server's KEYED hash of the token — lib/crypto lookupHash — so the database receives
-- that keyed hash, computed by the server from the request's cookie. A connection without the server's key cannot make
-- a session row that the server will accept, nor turn a stored hash back into a cookie.)
CREATE OR REPLACE FUNCTION app_review_session(reviewer uuid) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE tok text := nullif(current_setting('app.session_token', true), ''); sid uuid;
BEGIN
  IF tok IS NULL OR reviewer IS NULL THEN RETURN NULL; END IF;
  SELECT s.id INTO sid FROM sessions s JOIN users u ON u.id = s.user_id
   WHERE s.token_hash = tok AND s.user_id = reviewer
     AND s.revoked_at IS NULL AND s.idle_expires_at > now() AND s.absolute_expires_at > now()
     AND s.mfa_verified AND u.is_staff AND u.status = 'active' AND (u.locked_until IS NULL OR u.locked_until < now());
  RETURN sid;
END $$;
REVOKE ALL ON FUNCTION app_review_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_review_session(uuid) TO waqfak_app;

CREATE OR REPLACE FUNCTION kb_review_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'ref_match_reviews' AND NEW.decision <> 'accepted' THEN
    NEW.session_id := app_review_session(NEW.reviewer_user_id);
    RETURN NEW;
  END IF;
  NEW.session_id := app_review_session(NEW.reviewer_user_id);
  IF NEW.session_id IS NULL THEN
    RAISE EXCEPTION '%: a review is recorded only in the reviewer''s own authenticated session (no valid session token)', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kb_review_session ON kb_source_reviews;
CREATE TRIGGER kb_review_session BEFORE INSERT ON kb_source_reviews FOR EACH ROW EXECUTE FUNCTION kb_review_session();
DROP TRIGGER IF EXISTS kb_review_session ON ref_match_reviews;
CREATE TRIGGER kb_review_session BEFORE INSERT ON ref_match_reviews FOR EACH ROW EXECUTE FUNCTION kb_review_session();

-- At use: whether the session a review names existed, belonged to the reviewer and was valid when the review was made.
-- (Read by the engine in the system context; sessions are not exposed beyond this yes/no.)
CREATE OR REPLACE FUNCTION knowledge_review_sessions(kind text, ids uuid[]) RETURNS TABLE (id uuid, ok boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, EXISTS (SELECT 1 FROM sessions s WHERE s.id = r.session_id AND s.user_id = r.reviewer_user_id
           AND s.created_at <= r.at AND s.absolute_expires_at > r.at AND (s.revoked_at IS NULL OR s.revoked_at > r.at) AND s.mfa_verified)
  FROM (
    SELECT k.id, k.session_id, k.reviewer_user_id, k.at FROM kb_source_reviews k WHERE kind = 'kb_source_review' AND k.id = ANY (ids)
    UNION ALL SELECT m.id, m.session_id, m.reviewer_user_id, m.reviewed_at FROM ref_match_reviews m WHERE kind = 'ref_match_review' AND m.id = ANY (ids)
    UNION ALL SELECT f.id, f.session_id, f.reviewer_user_id, f.at FROM fiqh_reviews f WHERE kind = 'fiqh_review' AND f.id = ANY (ids)
  ) r
$$;
REVOKE ALL ON FUNCTION knowledge_review_sessions(text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION knowledge_review_sessions(text, uuid[]) TO waqfak_app;

-- ───────────── Fiqh research dossiers and their human reviews ─────────────
-- Team-side only (no waqf member reads them). Dossiers are written by the engine (system context) or staff; reviews by a
-- reviewer in their own authenticated session, holding the field's permission, with its audit entry. Both append-only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fiqh_dossiers','fiqh_reviews'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS fiqh_read ON %I', t);
    EXECUTE format('CREATE POLICY fiqh_read ON %I FOR SELECT TO waqfak_app USING (app_is_system() OR app_is_staff())', t);
    EXECUTE format('DROP TRIGGER IF EXISTS ref_append_only ON %I', t);
    EXECUTE format('CREATE TRIGGER ref_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ref_append_only()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS ref_no_truncate ON %I', t);
    EXECUTE format('CREATE TRIGGER ref_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION ref_append_only()', t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM waqfak_app', t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS fiqh_dossier_insert ON fiqh_dossiers;
CREATE POLICY fiqh_dossier_insert ON fiqh_dossiers FOR INSERT TO waqfak_app WITH CHECK (app_is_system() OR app_is_staff());
DROP POLICY IF EXISTS fiqh_review_insert ON fiqh_reviews;
CREATE POLICY fiqh_review_insert ON fiqh_reviews FOR INSERT TO waqfak_app WITH CHECK (reviewer_user_id = app_current_user() AND app_is_staff());

CREATE OR REPLACE FUNCTION fiqh_review_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d record;
BEGIN
  IF app_current_user() IS NULL OR app_current_user() <> NEW.reviewer_user_id THEN
    RAISE EXCEPTION 'fiqh_reviews: a review is recorded only by the reviewer, in the reviewer''s own session' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO d FROM fiqh_dossiers WHERE id = NEW.dossier_id;
  IF NOT FOUND OR d.sha256 <> NEW.dossier_sha256 THEN
    RAISE EXCEPTION 'fiqh_reviews: the review does not name the dossier''s content' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reviewer_role <> d.review_role THEN
    RAISE EXCEPTION 'fiqh_reviews: this dossier is reviewed by the % field', d.review_role USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.reviewer_user_id AND u.status = 'active' AND (u.locked_until IS NULL OR u.locked_until < now())) THEN
    RAISE EXCEPTION 'fiqh_reviews: reviewer is not an active user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
                 WHERE ur.user_id = NEW.reviewer_user_id AND p.key = 'knowledge.review.' || NEW.reviewer_role) THEN
    RAISE EXCEPTION 'fiqh_reviews: reviewer lacks knowledge.review.%', NEW.reviewer_role USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- the engine's account never reviews what the engine produced
  IF d.created_by IS NOT NULL AND d.created_by = NEW.reviewer_user_id THEN
    RAISE EXCEPTION 'fiqh_reviews: the author of a dossier does not review it' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.session_id := app_review_session(NEW.reviewer_user_id);
  IF NEW.session_id IS NULL THEN
    RAISE EXCEPTION 'fiqh_reviews: a review is recorded only in the reviewer''s own authenticated session (no valid session token)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fiqh_review_guard ON fiqh_reviews;
CREATE TRIGGER fiqh_review_guard BEFORE INSERT ON fiqh_reviews FOR EACH ROW EXECUTE FUNCTION fiqh_review_guard();

CREATE OR REPLACE FUNCTION fiqh_review_audited() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.action = 'knowledge.review.recorded' AND a.entity_type = 'fiqh_review'
                 AND a.entity_id = NEW.id::text AND a.actor_user_id = NEW.reviewer_user_id) THEN
    RAISE EXCEPTION 'fiqh_reviews: review % has no audit entry', NEW.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS fiqh_review_audited ON fiqh_reviews;
CREATE CONSTRAINT TRIGGER fiqh_review_audited AFTER INSERT ON fiqh_reviews DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fiqh_review_audited();

-- ───────────── B13 at the final approval: what a final output cites must be human-reviewed, passage by passage ─────────────
-- Defence in depth for the server's gate (outputs/quality.ts): an output does not become «approved» while a passage it
-- cites (a specialist block's refs) has no accepted review of that passage, recorded in an authenticated session by a
-- holder of the field's permission — nor while a fiqh dossier it rests on has no approving review. The seal and the
-- audit hash are verified by the server; the database checks what it can see.
CREATE OR REPLACE FUNCTION sections_unreviewed_basis(secs jsonb) RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer := 0;
BEGIN
  IF secs IS NULL THEN RETURN 0; END IF;
  WITH refs AS (
    SELECT (r->>'chunkId')::uuid AS chunk_id FROM jsonb_path_query(secs, '$[*] ? (!(exists(@.removed)) || @.removed != true).blocks[*] ? (@.type == "specialist").refs[*]') r
    WHERE r ? 'chunkId'
  ), held AS (
    SELECT DISTINCT ur.user_id, substr(p.key, 18) AS role FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id JOIN users u ON u.id = ur.user_id
    WHERE p.key LIKE 'knowledge.review.%' AND u.status = 'active' AND (u.locked_until IS NULL OR u.locked_until < now())
  )
  SELECT count(*) INTO n FROM refs x JOIN kb_chunks c ON c.id = x.chunk_id JOIN kb_sources s ON s.id = c.source_id
  WHERE NOT (
    CASE WHEN s.registry_id IS NOT NULL THEN EXISTS (
      SELECT 1 FROM ref_sources rs JOIN ref_versions rv ON rv.source_id = rs.id JOIN ref_match_runs mr ON mr.version_id = rv.id
      JOIN ref_match_reviews mv ON mv.run_id = mr.id JOIN held h ON h.user_id = mv.reviewer_user_id AND h.role = 'legal'
      WHERE rs.code = s.registry_id AND mv.decision = 'accepted' AND mv.session_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ref_match_reviews later WHERE later.run_id = mr.id AND later.reviewed_at > mv.reviewed_at))
    ELSE EXISTS (
      SELECT 1 FROM kb_source_reviews k JOIN held h ON h.user_id = k.reviewer_user_id AND h.role = k.reviewer_role
      WHERE k.chunk_id = c.id AND k.decision = 'accepted' AND k.session_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM kb_source_reviews later WHERE later.chunk_id = c.id AND later.reviewer_role = k.reviewer_role AND later.at > k.at))
    END);
  -- every dossier a block rests on needs an approving (or modifying) review by a holder of its field, on its content
  WITH held AS (
    SELECT DISTINCT ur.user_id, substr(p.key, 18) AS role FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id JOIN users u ON u.id = ur.user_id
    WHERE p.key LIKE 'knowledge.review.%' AND u.status = 'active' AND (u.locked_until IS NULL OR u.locked_until < now())
  )
  SELECT n + count(*) INTO n FROM (
    SELECT DISTINCT (b->>'dossierId')::uuid AS did FROM jsonb_path_query(secs, '$[*] ? (!(exists(@.removed)) || @.removed != true).blocks[*] ? (@.type == "specialist" && exists(@.dossierId))') b
  ) x JOIN fiqh_dossiers d ON d.id = x.did
  WHERE NOT EXISTS (
    SELECT 1 FROM fiqh_reviews f JOIN held h ON h.user_id = f.reviewer_user_id AND h.role = f.reviewer_role
    WHERE f.dossier_id = d.id AND f.dossier_sha256 = d.sha256 AND f.decision IN ('approved', 'modified') AND f.session_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM fiqh_reviews later WHERE later.dossier_id = d.id AND later.at > f.at));
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION sections_unreviewed_basis(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sections_unreviewed_basis(jsonb) TO waqfak_app;
CREATE OR REPLACE FUNCTION output_unreviewed_basis(oid uuid, ver integer) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT sections_unreviewed_basis(sections) FROM output_versions WHERE output_id = oid AND version = ver), 0)
$$;
REVOKE ALL ON FUNCTION output_unreviewed_basis(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION output_unreviewed_basis(uuid, integer) TO waqfak_app;

CREATE OR REPLACE FUNCTION guard_output_basis() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  IF NEW.status = 'approved' AND NEW.status IS DISTINCT FROM OLD.status THEN
    n := output_unreviewed_basis(NEW.id, NEW.current_version);
    IF n > 0 THEN
      RAISE EXCEPTION 'output_guard: % cited passage(s) or research dossier(s) without the required human review', n USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS outputs_basis_guard ON outputs;
CREATE TRIGGER outputs_basis_guard BEFORE UPDATE OF status ON outputs FOR EACH ROW EXECUTE FUNCTION guard_output_basis();

-- Independent review, round 6 (2026-11-07).
-- 2j: an account's standing (status, lock, staff flag, second factor) is changed, from a user session, only by a holder
-- of «admin.users» — an ordinary user could reactivate a locked reviewer, whose reviews then counted again.
CREATE OR REPLACE FUNCTION users_standing_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT app_is_system() AND app_current_user() IS DISTINCT FROM OLD.id
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.locked_until IS DISTINCT FROM OLD.locked_until
          OR NEW.is_staff IS DISTINCT FROM OLD.is_staff OR NEW.mfa_enabled IS DISTINCT FROM OLD.mfa_enabled
          OR NEW.failed_login_count IS DISTINCT FROM OLD.failed_login_count)
     AND NOT app_holds('admin.users') THEN
    RAISE EXCEPTION 'users: another account''s status, lock, staff flag or second factor is changed only by admin.users' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_standing_guard ON users;
CREATE TRIGGER users_standing_guard BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION users_standing_guard();

-- N5-1 (system context): the application role setting app.user_id to '' is the system context, which the guards above
-- let through for the seed and the bootstrap. A reviewer is never named from it: with the application role, a role
-- carrying «knowledge.review.*» is granted — and such a permission added to a role — only from an administrator's own
-- session (holder of admin.roles, not for themselves). The seed runs with the owner role and is unaffected.
CREATE OR REPLACE FUNCTION reviewer_grant_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF session_user = 'waqfak_app' AND app_is_system() AND TG_OP <> 'DELETE' THEN
    IF TG_TABLE_NAME = 'user_roles' THEN
      IF EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = (to_jsonb(NEW)->>'role_id')::uuid AND p.key LIKE 'knowledge.review.%') THEN
        RAISE EXCEPTION 'user_roles: a reviewer role is granted only from an administrator''s session' USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF EXISTS (SELECT 1 FROM permissions p WHERE p.id = (to_jsonb(NEW)->>'permission_id')::uuid AND p.key LIKE 'knowledge.review.%') THEN
      RAISE EXCEPTION 'role_permissions: a reviewer permission is added only from an administrator''s session' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS reviewer_grant_guard ON user_roles;
CREATE TRIGGER reviewer_grant_guard BEFORE INSERT OR UPDATE ON user_roles FOR EACH ROW EXECUTE FUNCTION reviewer_grant_guard();
DROP TRIGGER IF EXISTS reviewer_grant_guard ON role_permissions;
CREATE TRIGGER reviewer_grant_guard BEFORE INSERT OR UPDATE ON role_permissions FOR EACH ROW EXECUTE FUNCTION reviewer_grant_guard();


-- Independent review, round 7 (2026-11-07).
-- Sessions: a user session sees and changes only its own sessions; the system context (login, logout, expiry) all.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sessions_own ON sessions;
CREATE POLICY sessions_own ON sessions FOR ALL TO waqfak_app USING (app_is_system() OR user_id = app_current_user()) WITH CHECK (app_is_system() OR user_id = app_current_user());

-- 2j, extended: from a user session, another account's row is changed only by a holder of «admin.users» (or
-- «admin.notifications», which carries out data-subject requests) — not its phone, e-mail, password or identity either.
CREATE OR REPLACE FUNCTION users_standing_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT app_is_system() AND app_current_user() IS DISTINCT FROM OLD.id
     AND (to_jsonb(NEW) - 'updated_at' - 'updated_by' - 'last_login_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at' - 'updated_by' - 'last_login_at')
     AND NOT (app_holds('admin.users') OR app_holds('admin.notifications')) THEN
    RAISE EXCEPTION 'users: another account is changed only by admin.users' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- N5-1 (system context, round 7): with the application role, the system context grants a role carrying «admin.roles»
-- only while no active account holds it (the first administrator's bootstrap); after that, administrators are named by
-- an administrator from their own session.
CREATE OR REPLACE FUNCTION admin_grant_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF session_user = 'waqfak_app' AND app_is_system()
     AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = NEW.role_id AND p.key IN ('admin.roles', 'outputs.final_approve', 'approvals.direct'))
     AND EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id JOIN users u ON u.id = ur.user_id
                 WHERE p.key = 'admin.roles' AND u.status = 'active' AND ur.user_id <> NEW.user_id) THEN
    RAISE EXCEPTION 'user_roles: an administrator role is granted from the system context only for the first administrator' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS admin_grant_guard ON user_roles;
CREATE TRIGGER admin_grant_guard BEFORE INSERT OR UPDATE ON user_roles FOR EACH ROW EXECUTE FUNCTION admin_grant_guard();
-- and «admin.roles» is never added to a role from the system context with the application role
CREATE OR REPLACE FUNCTION admin_perm_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF session_user = 'waqfak_app' AND app_is_system() AND EXISTS (SELECT 1 FROM permissions p WHERE p.id = NEW.permission_id AND p.key IN ('admin.roles', 'admin.users', 'outputs.final_approve', 'approvals.direct')) THEN
    RAISE EXCEPTION 'role_permissions: an administrator permission is added only from an administrator''s session' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS admin_perm_guard ON role_permissions;
CREATE TRIGGER admin_perm_guard BEFORE INSERT OR UPDATE ON role_permissions FOR EACH ROW EXECUTE FUNCTION admin_perm_guard();

-- Registry comparison reviews: no review dated in the future (a rejection «in 2100» would outlive every acceptance).
CREATE OR REPLACE FUNCTION ref_review_time() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reviewed_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'ref_match_reviews: a review is not dated in the future' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ref_review_time ON ref_match_reviews;
CREATE TRIGGER ref_review_time BEFORE INSERT ON ref_match_reviews FOR EACH ROW EXECUTE FUNCTION ref_review_time();

-- A dossier names its author: from a user session, that user; from the system context, an account (the engine's). A
-- dossier without an author could be approved by whoever inserted it.
CREATE OR REPLACE FUNCTION fiqh_dossier_author() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.created_by IS NULL OR (NOT app_is_system() AND NEW.created_by IS DISTINCT FROM app_current_user()) THEN
    RAISE EXCEPTION 'fiqh_dossiers: a dossier names its author (the session''s user, or the engine''s account)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fiqh_dossier_author ON fiqh_dossiers;
CREATE TRIGGER fiqh_dossier_author BEFORE INSERT ON fiqh_dossiers FOR EACH ROW EXECUTE FUNCTION fiqh_dossier_author();

-- The final guard, tightened: an output is never inserted already approved; the version checked is the one approved
-- (approved_version, else current_version), on any change of status or of either version; a reference without a
-- passage id, a dossier id that does not exist, or a review by another field than the source's counts as unreviewed.
CREATE OR REPLACE FUNCTION kb_source_role(s kb_sources) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(s.meta->>'reviewRole', CASE s.ref_kind
    WHEN 'professional_standard' THEN 'accounting' WHEN 'classical_fiqh' THEN 'sharia' WHEN 'contemporary_book' THEN 'sharia'
    WHEN 'statistical_source' THEN 'data' WHEN 'dataset' THEN 'data' ELSE 'legal' END)
$$;
CREATE OR REPLACE FUNCTION sections_unreviewed_basis(secs jsonb) RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer := 0; m integer := 0;
BEGIN
  IF secs IS NULL THEN RETURN 0; END IF;
  WITH held AS (
    SELECT DISTINCT ur.user_id, substr(p.key, 18) AS role FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id JOIN users u ON u.id = ur.user_id
    WHERE p.key LIKE 'knowledge.review.%' AND u.status = 'active' AND (u.locked_until IS NULL OR u.locked_until < now())
  ), refs AS (
    SELECT r->>'chunkId' AS cid FROM jsonb_path_query(secs, '$[*] ? (!(exists(@.removed)) || @.removed != true).blocks[*] ? (@.type == "specialist").refs[*]') r
  )
  SELECT count(*) INTO n FROM refs x
  LEFT JOIN kb_chunks c ON x.cid ~* '^[0-9a-f-]{36}$' AND c.id = x.cid::uuid LEFT JOIN kb_sources s ON s.id = c.source_id
  WHERE c.id IS NULL OR NOT (
    CASE WHEN s.registry_id IS NOT NULL THEN EXISTS (
      SELECT 1 FROM ref_sources rs JOIN ref_versions rv ON rv.source_id = rs.id JOIN ref_match_runs mr ON mr.version_id = rv.id
      JOIN ref_match_reviews mv ON mv.run_id = mr.id JOIN held h ON h.user_id = mv.reviewer_user_id AND h.role = 'legal'
      WHERE rs.code = s.registry_id AND mv.decision = 'accepted' AND mv.session_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ref_match_reviews later WHERE later.run_id = mr.id AND later.reviewed_at > mv.reviewed_at))
    ELSE EXISTS (
      SELECT 1 FROM kb_source_reviews k JOIN held h ON h.user_id = k.reviewer_user_id AND h.role = k.reviewer_role
      WHERE k.chunk_id = c.id AND k.decision = 'accepted' AND k.session_id IS NOT NULL AND k.reviewer_role = kb_source_role(s)
        AND NOT EXISTS (SELECT 1 FROM kb_source_reviews later WHERE later.reviewer_role = k.reviewer_role AND later.at > k.at
                        AND (later.chunk_id = c.id OR (later.chunk_id IS NULL AND later.source_id = s.id AND later.decision = 'rejected'))))
    END);
  WITH held AS (
    SELECT DISTINCT ur.user_id, substr(p.key, 18) AS role FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id JOIN users u ON u.id = ur.user_id
    WHERE p.key LIKE 'knowledge.review.%' AND u.status = 'active' AND (u.locked_until IS NULL OR u.locked_until < now())
  ), ds AS (
    SELECT DISTINCT b->>'dossierId' AS did FROM jsonb_path_query(secs, '$[*] ? (!(exists(@.removed)) || @.removed != true).blocks[*] ? (@.type == "specialist" && exists(@.dossierId))') b
  )
  SELECT count(*) INTO m FROM ds x LEFT JOIN fiqh_dossiers d ON x.did ~* '^[0-9a-f-]{36}$' AND d.id = x.did::uuid
  WHERE d.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM fiqh_reviews f JOIN held h ON h.user_id = f.reviewer_user_id AND h.role = f.reviewer_role
    WHERE f.dossier_id = d.id AND f.dossier_sha256 = d.sha256 AND f.reviewer_role = d.review_role AND f.decision IN ('approved', 'modified')
      AND f.session_id IS NOT NULL AND f.reviewer_user_id IS DISTINCT FROM d.created_by
      AND NOT EXISTS (SELECT 1 FROM fiqh_reviews later WHERE later.dossier_id = d.id AND later.at > f.at));
  RETURN n + m;
END $$;

CREATE OR REPLACE FUNCTION guard_output_basis() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'approved' THEN
      RAISE EXCEPTION 'output_guard: an output is not created already approved' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'approved' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.approved_version IS DISTINCT FROM OLD.approved_version OR NEW.current_version IS DISTINCT FROM OLD.current_version) THEN
    n := output_unreviewed_basis(NEW.id, coalesce(NEW.approved_version, NEW.current_version));
    IF NEW.approved_version IS NOT NULL AND NEW.approved_version <> NEW.current_version THEN
      n := n + output_unreviewed_basis(NEW.id, NEW.current_version);
    END IF;
    IF n > 0 THEN
      RAISE EXCEPTION 'output_guard: % cited passage(s) or research dossier(s) without the required human review', n USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS outputs_basis_guard ON outputs;
CREATE TRIGGER outputs_basis_guard BEFORE INSERT OR UPDATE OF status, approved_version, current_version ON outputs FOR EACH ROW EXECUTE FUNCTION guard_output_basis();

-- ═════════════ Owner's order of 2026-11-08 ═════════════
-- G13: an id that is not a uuid makes the guard count the reference as unreviewed, never fail the whole check with a
-- cast error (a CASE/regex guard does not short-circuit the cast in a join condition).
CREATE OR REPLACE FUNCTION try_uuid(t text) RETURNS uuid LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN t::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

-- N7-14: every passage put before the model for a section («basis»), cited or not, needs its review as a cited one does;
-- a passage of a superseded version of a non-registry source is not a basis.
CREATE OR REPLACE FUNCTION sections_unreviewed_basis(secs jsonb) RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer := 0; m integer := 0;
BEGIN
  IF secs IS NULL THEN RETURN 0; END IF;
  WITH held AS (
    SELECT DISTINCT ur.user_id, substr(p.key, 18) AS role FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id JOIN users u ON u.id = ur.user_id
    WHERE p.key LIKE 'knowledge.review.%' AND u.status = 'active' AND (u.locked_until IS NULL OR u.locked_until < now())
  ), refs AS (
    SELECT DISTINCT r->>'chunkId' AS cid FROM jsonb_path_query(secs, '$[*] ? (!(exists(@.removed)) || @.removed != true).blocks[*] ? (@.type == "specialist").refs[*]') r
    UNION
    SELECT DISTINCT r->>'chunkId' AS cid FROM jsonb_path_query(secs, '$[*] ? (!(exists(@.removed)) || @.removed != true).blocks[*] ? (@.type == "specialist").basis[*]') r
  )
  SELECT count(*) INTO n FROM refs x
  LEFT JOIN kb_chunks c ON c.id = try_uuid(x.cid) LEFT JOIN kb_sources s ON s.id = c.source_id
  WHERE c.id IS NULL OR (s.registry_id IS NULL AND s.superseded_at IS NOT NULL) OR NOT (
    CASE WHEN s.registry_id IS NOT NULL THEN EXISTS (
      SELECT 1 FROM ref_sources rs JOIN ref_versions rv ON rv.source_id = rs.id JOIN ref_match_runs mr ON mr.version_id = rv.id
      JOIN ref_match_reviews mv ON mv.run_id = mr.id JOIN held h ON h.user_id = mv.reviewer_user_id AND h.role = 'legal'
      WHERE rs.code = s.registry_id AND mv.decision = 'accepted' AND mv.session_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ref_match_reviews later WHERE later.run_id = mr.id AND later.reviewed_at > mv.reviewed_at))
    ELSE EXISTS (
      SELECT 1 FROM kb_source_reviews k JOIN held h ON h.user_id = k.reviewer_user_id AND h.role = k.reviewer_role
      WHERE k.chunk_id = c.id AND k.decision = 'accepted' AND k.session_id IS NOT NULL AND k.reviewer_role = kb_source_role(s)
        AND NOT EXISTS (SELECT 1 FROM kb_source_reviews later WHERE later.reviewer_role = k.reviewer_role AND later.at > k.at
                        AND (later.chunk_id = c.id OR (later.chunk_id IS NULL AND later.source_id = s.id AND later.decision = 'rejected'))))
    END);
  WITH held AS (
    SELECT DISTINCT ur.user_id, substr(p.key, 18) AS role FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id JOIN users u ON u.id = ur.user_id
    WHERE p.key LIKE 'knowledge.review.%' AND u.status = 'active' AND (u.locked_until IS NULL OR u.locked_until < now())
  ), ds AS (
    SELECT DISTINCT b->>'dossierId' AS did FROM jsonb_path_query(secs, '$[*] ? (!(exists(@.removed)) || @.removed != true).blocks[*] ? (@.type == "specialist" && exists(@.dossierId))') b
  )
  SELECT count(*) INTO m FROM ds x LEFT JOIN fiqh_dossiers d ON d.id = try_uuid(x.did)
  WHERE d.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM fiqh_reviews f JOIN held h ON h.user_id = f.reviewer_user_id AND h.role = f.reviewer_role
    WHERE f.dossier_id = d.id AND f.dossier_sha256 = d.sha256 AND f.reviewer_role = d.review_role AND f.decision IN ('approved', 'modified')
      AND f.session_id IS NOT NULL AND f.reviewer_user_id IS DISTINCT FROM d.created_by
      AND NOT EXISTS (SELECT 1 FROM fiqh_reviews later WHERE later.dossier_id = d.id AND later.at > f.at));
  RETURN n + m;
END $$;

-- B5 (round 7, self): from their own session, an account does not change its own standing — its status (pending to
-- active included), staff flag, second factor, failed-login count, phone or phone verification — nor mark its e-mail
-- verified. Those are set by the sign-in and verification flows (system context) or by an administrator for others.
CREATE OR REPLACE FUNCTION users_self_standing_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT app_is_system() AND app_current_user() = OLD.id AND (
       NEW.status IS DISTINCT FROM OLD.status OR NEW.is_staff IS DISTINCT FROM OLD.is_staff
    OR NEW.mfa_enabled IS DISTINCT FROM OLD.mfa_enabled OR NEW.failed_login_count IS DISTINCT FROM OLD.failed_login_count
    OR NEW.phone IS DISTINCT FROM OLD.phone OR NEW.phone_verified_at IS DISTINCT FROM OLD.phone_verified_at
    OR (NEW.email_verified_at IS DISTINCT FROM OLD.email_verified_at AND NEW.email_verified_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'users: an account does not change its own status, staff flag, second factor, login counter, phone or verification' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_self_standing_guard ON users;
CREATE TRIGGER users_self_standing_guard BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION users_self_standing_guard();

-- N7-15: a review's time is the database's clock, whatever the application sends, so that it compares with the session
-- times (also the database's) without a skew between two clocks; a review is never back- or forward-dated by the
-- application role.
CREATE OR REPLACE FUNCTION review_db_time() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('waqfak_app', 'waqfak_system') THEN  -- stage 11: every non-owner writer
    -- the wall clock (clock_timestamp), not the transaction's start: two reviews in one transaction keep their order
    IF TG_TABLE_NAME = 'ref_match_reviews' THEN NEW.reviewed_at := clock_timestamp(); ELSE NEW.at := clock_timestamp(); END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS review_db_time ON kb_source_reviews;
CREATE TRIGGER review_db_time BEFORE INSERT ON kb_source_reviews FOR EACH ROW EXECUTE FUNCTION review_db_time();
DROP TRIGGER IF EXISTS review_db_time ON ref_match_reviews;
CREATE TRIGGER review_db_time BEFORE INSERT ON ref_match_reviews FOR EACH ROW EXECUTE FUNCTION review_db_time();
DROP TRIGGER IF EXISTS review_db_time ON fiqh_reviews;
CREATE TRIGGER review_db_time BEFORE INSERT ON fiqh_reviews FOR EACH ROW EXECUTE FUNCTION review_db_time();

-- ═════════════ Phase 10, N9-9: an engine-written text is bound to its run, references, basis and dossier ═════════════
-- The same canonical string as modules/outputs/binding.ts bindingInput(): text, run, writer, «n:chunk» by n, the basis
-- chunks sorted (byte order) and deduplicated, the dossier — joined by newlines; its sha256 must equal the block's
-- «binding». A model's text must also cite something, have a basis, cite only from its basis, and every [n] in the text
-- must be a cited reference. Counted per faulty block; output_unreviewed_basis() adds it to the approval guard.
-- Stage 11 (N10-15, N10-16): a citation «[٣]» or «[۳]» is the citation «[3]»; an engine block's run id is never empty;
-- an engine block's binding must be in the engine's own registry (engine_blocks, written by the engine's system
-- connection only) with the same run and text; and a block not labelled as the engine's whose text is an engine text
-- (relabelled «template» or «person», or re-spaced) is refused — the gate does not take the label's word for it.
CREATE OR REPLACE FUNCTION block_text_sha(t text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT encode(sha256(convert_to(regexp_replace(coalesce(t, ''), E'[\\t\\n\\u000b\\f\\r \\u00a0\\u1680\\u2000-\\u200d\\u2028\\u2029\\u202f\\u205f\\u2060\\u3000\\ufeff]+', '', 'g'), 'UTF8')), 'hex')
$$;
CREATE OR REPLACE FUNCTION ascii_digits(t text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT translate(t, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')
$$;
CREATE OR REPLACE FUNCTION specialist_block_errors(secs jsonb) RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE b jsonb; n integer := 0; refs text; basis text; want text; bad boolean; tsha text;
BEGIN
  IF secs IS NULL THEN RETURN 0; END IF;
  FOR b IN SELECT x FROM jsonb_path_query(secs, '$[*] ? (!(exists(@.removed)) || @.removed != true).blocks[*] ? (@.type == "specialist")') x LOOP
    -- a text that cites [n] (in any digits) carries the references it cites, whoever wrote it
    IF EXISTS (SELECT 1 FROM regexp_matches(coalesce(b->>'text', ''), '\[([0-9٠-٩۰-۹]{1,3})\]', 'g') m
               WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(b->'refs', '[]'::jsonb)) r WHERE (r->>'n') = ascii_digits(m[1])::int::text)) THEN
      n := n + 1; CONTINUE;
    END IF;
    CONTINUE WHEN btrim(coalesce(b->>'text', '')) = '';
    tsha := block_text_sha(b->>'text');
    IF coalesce(b->>'by', '') <> 'engine' THEN
      -- an engine text under another label (N10-16)
      IF EXISTS (SELECT 1 FROM engine_blocks e WHERE e.text_sha256 = tsha) THEN n := n + 1; END IF;
      CONTINUE;
    END IF;
    SELECT coalesce(string_agg((r->>'n') || ':' || (r->>'chunkId'), ',' ORDER BY (r->>'n')::int), '') INTO refs FROM jsonb_array_elements(coalesce(b->'refs', '[]'::jsonb)) r;
    SELECT coalesce(string_agg(c, ',' ORDER BY c COLLATE "C"), '') INTO basis FROM (SELECT DISTINCT r->>'chunkId' AS c FROM jsonb_array_elements(coalesce(b->'basis', '[]'::jsonb)) r) x;
    want := encode(sha256(convert_to(concat_ws(E'\n', b->>'text', coalesce(b->>'runId', ''), coalesce(b->>'writer', ''), refs, basis, coalesce(b->>'dossierId', '')), 'UTF8')), 'hex');
    bad := btrim(coalesce(b->>'runId', '')) = '' OR coalesce(b->>'writer', '') NOT IN ('model', 'template') OR b->>'binding' IS DISTINCT FROM want
        -- … and the engine wrote it: its binding is in the registry, from the same run, with the same text and writer
        OR NOT EXISTS (SELECT 1 FROM engine_blocks e WHERE e.binding = want AND e.run_id::text = b->>'runId' AND e.text_sha256 = tsha AND e.writer = b->>'writer');
    IF NOT bad AND b->>'writer' = 'model' THEN
      bad := jsonb_array_length(coalesce(b->'refs', '[]'::jsonb)) = 0 OR jsonb_array_length(coalesce(b->'basis', '[]'::jsonb)) = 0
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(b->'refs') r WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(b->'basis') x WHERE x->>'chunkId' = r->>'chunkId'));
    END IF;
    IF bad THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION specialist_block_errors(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION specialist_block_errors(jsonb) TO waqfak_app;
CREATE OR REPLACE FUNCTION output_unreviewed_basis(oid uuid, ver integer) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce((SELECT sections_unreviewed_basis(sections) + specialist_block_errors(sections) FROM output_versions WHERE output_id = oid AND version = ver), 0)
$$;

-- ═════════════ Phase 10, N9-3: share uses, revocations and acceptances are not undone ═════════════
-- The use log of a share link is append-only for the application (the limit counts its rows, not a column). The parts
-- of a share or an invitation fixed at issue never change; a revocation is never cleared; an acceptance is never
-- cleared or moved; the display counter of uses only grows. (The HMAC binding detects a changed row at use; these
-- refuse the change itself — including the parts the binding cannot cover because they must change once.)
ALTER TABLE document_share_uses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dsu_app ON document_share_uses;
CREATE POLICY dsu_app ON document_share_uses FOR ALL TO waqfak_app USING (true) WITH CHECK (true);
REVOKE UPDATE, DELETE, TRUNCATE ON document_share_uses FROM waqfak_app;
DROP TRIGGER IF EXISTS document_share_uses_append_only ON document_share_uses;
CREATE TRIGGER document_share_uses_append_only BEFORE UPDATE OR DELETE ON document_share_uses FOR EACH ROW EXECUTE FUNCTION waqfak_append_only();

CREATE OR REPLACE FUNCTION capability_row_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user NOT IN ('waqfak_app', 'waqfak_system') THEN RETURN NEW; END IF;  -- stage 11: every non-owner writer
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.binding IS DISTINCT FROM OLD.binding OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.waqf_id IS DISTINCT FROM OLD.waqf_id OR NEW.id IS DISTINCT FROM OLD.id
     OR (TG_TABLE_NAME <> 'invitations' AND (to_jsonb(NEW)->>'created_by') IS DISTINCT FROM (to_jsonb(OLD)->>'created_by')) THEN
    RAISE EXCEPTION '%: what a link was issued for does not change', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION '%: a revocation is not undone', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_TABLE_NAME = 'document_shares' THEN
    IF NEW.document_id IS DISTINCT FROM OLD.document_id OR NEW.max_uses IS DISTINCT FROM OLD.max_uses OR NEW.uses < OLD.uses THEN
      RAISE EXCEPTION 'document_shares: the document, the use limit and the uses made do not go back' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF TG_TABLE_NAME = 'report_shares' THEN
    IF NEW.report_id IS DISTINCT FROM OLD.report_id OR NEW.views < OLD.views THEN
      RAISE EXCEPTION 'report_shares: the report and the views made do not go back' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF TG_TABLE_NAME = 'invitations' THEN
    IF NEW.phone IS DISTINCT FROM OLD.phone OR NEW.role_key IS DISTINCT FROM OLD.role_key OR NEW.invited_by IS DISTINCT FROM OLD.invited_by OR NEW.note IS DISTINCT FROM OLD.note THEN
      RAISE EXCEPTION 'invitations: what an invitation was issued for does not change' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- the scope may only gain the decline record (declinedAt/declinedBy), together with the revocation
    IF NEW.scope IS DISTINCT FROM OLD.scope AND NOT (NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL
         AND (coalesce(NEW.scope, '{}'::jsonb) - 'declinedAt' - 'declinedBy') = coalesce(OLD.scope, '{}'::jsonb)) THEN
      RAISE EXCEPTION 'invitations: what an invitation was issued for does not change' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.accepted_at IS NOT NULL AND (NEW.accepted_at IS DISTINCT FROM OLD.accepted_at OR NEW.accepted_by IS DISTINCT FROM OLD.accepted_by) THEN
      RAISE EXCEPTION 'invitations: an acceptance is not undone or moved' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS capability_row_guard ON document_shares;
CREATE TRIGGER capability_row_guard BEFORE UPDATE ON document_shares FOR EACH ROW EXECUTE FUNCTION capability_row_guard();
DROP TRIGGER IF EXISTS capability_row_guard ON report_shares;
CREATE TRIGGER capability_row_guard BEFORE UPDATE ON report_shares FOR EACH ROW EXECUTE FUNCTION capability_row_guard();
DROP TRIGGER IF EXISTS capability_row_guard ON invitations;
CREATE TRIGGER capability_row_guard BEFORE UPDATE ON invitations FOR EACH ROW EXECUTE FUNCTION capability_row_guard();
-- N10b-2 (independent review, round 10b): a revoked report is not brought back by the application — its share links
-- would show it again (the share page reads reports.revoked_at); a revocation is a one-way act, as for the links
-- N10c-2: nor by deleting the row and inserting it again, nor by renaming it and inserting a copy under its number
-- and verification code: the application never deletes a report, and a report's number and code do not change
CREATE OR REPLACE FUNCTION report_revocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user NOT IN ('waqfak_app', 'waqfak_system') THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'reports: a report is revoked, never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'reports: a revocation is not undone' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.number IS DISTINCT FROM OLD.number OR NEW.verification_code IS DISTINCT FROM OLD.verification_code THEN
    RAISE EXCEPTION 'reports: a report keeps its id, number and verification code' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
REVOKE DELETE, TRUNCATE ON reports FROM waqfak_app;
DROP TRIGGER IF EXISTS report_revocation_guard ON reports;
CREATE TRIGGER report_revocation_guard BEFORE UPDATE OR DELETE ON reports FOR EACH ROW EXECUTE FUNCTION report_revocation_guard();

-- N10-1 (independent review, round 10): a row deleted and inserted again as it was issued would undo its revocation,
-- its acceptance and its uses; the application never deletes a link or an invitation (it revokes them), so it may not
CREATE OR REPLACE FUNCTION capability_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('waqfak_app', 'waqfak_system') THEN  -- stage 11: every non-owner writer
    RAISE EXCEPTION '%: a link or an invitation is revoked, never deleted', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['document_shares', 'report_shares', 'invitations'] LOOP
    EXECUTE format('REVOKE DELETE, TRUNCATE ON %I FROM waqfak_app', t);
    EXECUTE format('DROP TRIGGER IF EXISTS capability_no_delete ON %I', t);
    EXECUTE format('CREATE TRIGGER capability_no_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION capability_no_delete()', t);
  END LOOP;
END $$;

-- ═════════════ Stage 11 (owner's decision of 2026-11-12), A: the identity is bound, never declared ═════════════
-- R8-1 / G10. Until now every policy and guard read the person and their latitude from variables the application set
-- (app.user_id, app.global_access, app.actor_roles): whoever held the application's connection — an injected query, a
-- leaked credential — could name any person, or none (the system), and the database believed it. Now:
--   • the application role (waqfak_app) names nobody: it BINDS a person with auth_bind(), which needs the keyed hash
--     of a live session's token — the server computes it from the request's cookie with HASH_KEY, which the database
--     never holds, and the application role cannot read the stored hashes. Unbound, it is an anonymous visitor.
--   • global latitude follows the bound person's roles (auth.global_roles), never a variable;
--   • the system context (jobs, public reads, link pages) is a different login, waqfak_system, and the sign-in,
--     sessions, codes and second factor are a third, waqfak_auth. The application role is a member of neither.
-- The owner keeps the variables (migrations, seed, test fixtures run as the owner or the system role).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waqfak_auth') OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waqfak_system') THEN
    RAISE EXCEPTION 'security.sql: the roles waqfak_auth and waqfak_system must exist first (scripts/db-bootstrap.sql, run by the DBA)';
  END IF;
  IF pg_has_role('waqfak_app', 'waqfak_system', 'MEMBER') OR pg_has_role('waqfak_app', 'waqfak_auth', 'MEMBER') THEN
    RAISE EXCEPTION 'security.sql: the application role must not be a member of waqfak_system or waqfak_auth';
  END IF;
  IF NOT pg_has_role('waqfak_system', 'waqfak_app', 'MEMBER') THEN
    RAISE EXCEPTION 'security.sql: waqfak_system must be a member of waqfak_app (it uses the same policies, as the system)';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
REVOKE ALL ON SCHEMA auth FROM PUBLIC;
CREATE TABLE IF NOT EXISTS auth.context (
  pid integer PRIMARY KEY, xact xid8 NOT NULL, user_id uuid NOT NULL, session_id uuid NOT NULL, mfa boolean NOT NULL,
  bound_at timestamptz NOT NULL DEFAULT clock_timestamp());
REVOKE ALL ON auth.context FROM PUBLIC;
-- the roles that see every waqf — authz/catalog.ts «globalAccess: true» (a test keeps the two lists equal)
CREATE TABLE IF NOT EXISTS auth.global_roles (role_key text PRIMARY KEY);
REVOKE ALL ON auth.global_roles FROM PUBLIC;
DELETE FROM auth.global_roles WHERE role_key NOT IN ('super_admin', 'management', 'ops_manager', 'nazara_manager');
INSERT INTO auth.global_roles VALUES ('super_admin'), ('management'), ('ops_manager'), ('nazara_manager') ON CONFLICT DO NOTHING;

-- token_hash: lib/crypto lookupHash of the session cookie (keyed). Binds this transaction of this backend only.
CREATE OR REPLACE FUNCTION auth_bind(token_hash text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE s record;
BEGIN
  DELETE FROM auth.context WHERE pid = pg_backend_pid();
  IF token_hash IS NULL OR length(token_hash) < 32 THEN RETURN NULL; END IF;
  SELECT x.id, x.user_id, x.mfa_verified INTO s FROM sessions x JOIN users u ON u.id = x.user_id
   WHERE x.token_hash = auth_bind.token_hash AND x.revoked_at IS NULL AND x.idle_expires_at > now() AND x.absolute_expires_at > now()
     AND u.status = 'active' AND (u.locked_until IS NULL OR u.locked_until < now());
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO auth.context (pid, xact, user_id, session_id, mfa) VALUES (pg_backend_pid(), pg_current_xact_id(), s.user_id, s.id, s.mfa_verified);
  RETURN s.user_id;
END $$;
REVOKE ALL ON FUNCTION auth_bind(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_bind(text) TO waqfak_app;

CREATE OR REPLACE FUNCTION app_bound() RETURNS auth.context LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT c FROM auth.context c WHERE c.pid = pg_backend_pid() AND c.xact = pg_current_xact_id_if_assigned()
$$;
REVOKE ALL ON FUNCTION app_bound() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF session_user = 'waqfak_app' THEN RETURN (app_bound()).user_id; END IF;
  IF session_user = 'waqfak_auth' THEN RETURN NULL; END IF;
  RETURN NULLIF(current_setting('app.user_id', true), '')::uuid;
END $$;

CREATE OR REPLACE FUNCTION app_bound_mfa() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT CASE WHEN session_user = 'waqfak_app' THEN coalesce((app_bound()).mfa, false) ELSE true END
$$;

CREATE OR REPLACE FUNCTION app_has_global_access() RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF session_user = 'waqfak_app' THEN
    RETURN EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN auth.global_roles g ON g.role_key = r.key
                   JOIN users u ON u.id = ur.user_id
                   WHERE ur.user_id = (app_bound()).user_id AND u.status = 'active' AND (u.locked_until IS NULL OR u.locked_until < now()));
  END IF;
  IF session_user = 'waqfak_auth' THEN RETURN false; END IF;
  RETURN coalesce(current_setting('app.global_access', true), 'off') = 'on';
END $$;

CREATE OR REPLACE FUNCTION app_is_system() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT session_user NOT IN ('waqfak_app', 'waqfak_auth') AND NULLIF(current_setting('app.user_id', true), '') IS NULL
$$;

-- the roles recorded with an audit entry: the bound person's, for the application role
CREATE OR REPLACE FUNCTION app_actor_roles() RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT CASE WHEN session_user = 'waqfak_app'
    THEN coalesce((SELECT array_agg(r.key ORDER BY r.key) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = (app_bound()).user_id), '{}')
    ELSE string_to_array(NULLIF(current_setting('app.actor_roles', true), ''), ',') END
$$;
REVOKE ALL ON FUNCTION app_current_user(), app_bound_mfa(), app_has_global_access(), app_is_system(), app_actor_roles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_current_user(), app_bound_mfa(), app_has_global_access(), app_is_system(), app_actor_roles() TO waqfak_app, waqfak_auth, waqfak_mlro;

-- an audit entry written by the application role names the bound person as its actor (or nobody, for an anonymous
-- visitor), with that person's roles — not whom the connection says
CREATE OR REPLACE FUNCTION audit_actor_bound() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF session_user = 'waqfak_app' AND NEW.actor_user_id IS DISTINCT FROM app_current_user() THEN
    RAISE EXCEPTION 'audit_logs: the actor of an entry is the bound person' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_actor_bound ON audit_logs;
CREATE TRIGGER audit_actor_bound BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_actor_bound();

-- ── the system role: the same policies as the application, as the system (it is a member of waqfak_app) ──
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO waqfak_system, waqfak_auth', current_database()); END $$;

-- ── the authentication role: sign-in, sessions, one-time codes, second factor, account creation ──
GRANT USAGE ON SCHEMA public TO waqfak_auth;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO waqfak_auth;
GRANT SELECT, INSERT, UPDATE ON users, sessions TO waqfak_auth;
GRANT DELETE ON sessions TO waqfak_auth;  -- the retention purge of ended sessions
GRANT SELECT, INSERT, UPDATE, DELETE ON mfa_factors, recovery_codes, otp_challenges, rate_limits TO waqfak_auth;
GRANT SELECT ON roles, user_roles, permissions, role_permissions TO waqfak_auth;
GRANT INSERT ON consents, audit_logs TO waqfak_auth;
GRANT EXECUTE ON FUNCTION app_audit_last_hash() TO waqfak_auth;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['sessions', 'audit_logs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS auth_role ON %I', t);
    EXECUTE format('CREATE POLICY auth_role ON %I FOR ALL TO waqfak_auth USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- ── what the application role can no longer do, bound or not ──
-- sessions: it reads its person's own sessions (no token hash) and ends them; it never creates or extends one
REVOKE ALL ON sessions FROM waqfak_app;
GRANT SELECT (id, user_id, mfa_verified, ip, user_agent, device_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at, revoke_reason) ON sessions TO waqfak_app;
GRANT UPDATE (revoked_at, revoke_reason) ON sessions TO waqfak_app;
DROP POLICY IF EXISTS sessions_own ON sessions;
CREATE POLICY sessions_own ON sessions FOR ALL TO waqfak_app
  USING (app_is_system() OR user_id = app_current_user() OR app_holds('admin.users'))
  WITH CHECK (app_is_system() OR user_id = app_current_user() OR app_holds('admin.users'));
-- a session is ended, never revived
CREATE OR REPLACE FUNCTION sessions_no_revive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'sessions: an ended session is not revived' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sessions_no_revive ON sessions;
CREATE TRIGGER sessions_no_revive BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION sessions_no_revive();
-- users: no account is created, deleted, or has its credentials, phone, standing or second factor changed by the
-- application role; profile columns only (the guards above still apply to them). An administrator's changes to
-- another account go through admin_* functions below, which check the bound administrator.
REVOKE ALL ON users FROM waqfak_app;
GRANT SELECT (id, phone, email, full_name, id_type, national_id_enc, national_id_hash, birth_date, locale, numeral_style, calendar_pref, status, is_staff, mfa_enabled, phone_verified_at, email_verified_at, locked_until, last_login_at, deletion_requested_at, resides_in_ksa, created_at, updated_at, created_by, updated_by) ON users TO waqfak_app;
GRANT UPDATE (full_name, email, email_verified_at, numeral_style, calendar_pref, locale, deletion_requested_at, id_type, national_id_enc, national_id_hash, birth_date, resides_in_ksa, updated_at, updated_by) ON users TO waqfak_app;
-- roles and permissions: granted only through admin_grant_role / admin_revoke_role; the catalogs are the seed's
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON user_roles, role_permissions, roles, permissions FROM waqfak_app;
-- second factor, recovery codes, one-time codes, rate limits: the authentication role's
REVOKE ALL ON mfa_factors, recovery_codes, otp_challenges FROM waqfak_app;
-- MLRO: SET ROLE waqfak_mlro alone opens nothing; the restricted rows need a bound MLRO with the second factor
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'restricted' AND c.relkind = 'r' LOOP
    EXECUTE format('ALTER TABLE restricted.%I ENABLE ROW LEVEL SECURITY', t.relname);
    EXECUTE format('DROP POLICY IF EXISTS mlro_bound ON restricted.%I', t.relname);
    EXECUTE format('CREATE POLICY mlro_bound ON restricted.%I FOR ALL TO waqfak_mlro USING (app_is_system() OR (app_holds(''mlro.access'') AND app_bound_mfa())) WITH CHECK (app_is_system() OR (app_holds(''mlro.access'') AND app_bound_mfa()))', t.relname);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app_holds(text) TO waqfak_mlro, waqfak_auth;

-- ── administrators act on other accounts through these, from their own bound session with the second factor ──
CREATE OR REPLACE FUNCTION admin_bound(perm text) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE me uuid := app_current_user();
BEGIN
  IF app_is_system() THEN RETURN NULL; END IF;
  IF me IS NULL OR NOT app_holds(perm) OR NOT app_bound_mfa() THEN
    RAISE EXCEPTION 'needs a bound administrator holding % with the second factor', perm USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN me;
END $$;
REVOKE ALL ON FUNCTION admin_bound(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION admin_grant_role(target uuid, role_key text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE me uuid := admin_bound('admin.roles'); rid uuid; n integer;
BEGIN
  SELECT r.id INTO rid FROM roles r WHERE r.key = role_key;
  IF rid IS NULL THEN RAISE EXCEPTION 'unknown role %', role_key; END IF;
  -- the guards on user_roles (no reviewer role for oneself, administrators named by an administrator) still run
  INSERT INTO user_roles (user_id, role_id, granted_by) VALUES (target, rid, me) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  -- a role of the platform's team makes the account a staff account (which then must enroll the second factor)
  IF n > 0 AND EXISTS (SELECT 1 FROM roles r WHERE r.id = rid AND r.scope = 'global') THEN
    UPDATE users SET is_staff = true, updated_at = now(), updated_by = me WHERE id = target AND NOT is_staff;
  END IF;
  RETURN n > 0;
END $$;
CREATE OR REPLACE FUNCTION admin_revoke_role(target uuid, role_key text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE me uuid := admin_bound('admin.roles'); n integer;
BEGIN
  DELETE FROM user_roles ur USING roles r WHERE ur.role_id = r.id AND ur.user_id = target AND r.key = role_key;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;
-- standing of another account: lock, unlock, staff flag, second factor reset
DROP FUNCTION IF EXISTS admin_set_standing(uuid, text, boolean, boolean);
CREATE FUNCTION admin_set_standing(target uuid, new_status text, staff boolean, reset_mfa boolean) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE me uuid := admin_bound('admin.users'); n integer := 0;
BEGIN
  IF me IS NOT NULL AND target = me THEN RAISE EXCEPTION 'an administrator does not change their own standing' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF new_status IS NOT NULL AND new_status NOT IN ('active', 'locked') THEN RAISE EXCEPTION 'admin_set_standing: active or locked'; END IF;
  UPDATE users SET
    status = coalesce(new_status::user_status, status),
    locked_until = CASE WHEN new_status = 'active' THEN NULL ELSE locked_until END,
    failed_login_count = CASE WHEN new_status = 'active' THEN 0 ELSE failed_login_count END,
    is_staff = coalesce(staff, is_staff),
    mfa_enabled = CASE WHEN reset_mfa THEN false ELSE mfa_enabled END,
    updated_at = now(), updated_by = me
  WHERE id = target;
  IF reset_mfa THEN
    DELETE FROM mfa_factors WHERE user_id = target;
    GET DIAGNOSTICS n = ROW_COUNT;
    DELETE FROM recovery_codes WHERE user_id = target;
  END IF;
  IF new_status = 'locked' OR reset_mfa THEN
    UPDATE sessions SET revoked_at = now(), revoke_reason = CASE WHEN reset_mfa THEN 'admin_mfa_reset' ELSE 'admin_lock' END WHERE user_id = target AND revoked_at IS NULL;
  END IF;
  RETURN n;
END $$;
-- an account created by an administrator (a staff member or a client on their behalf); its owner signs in by phone
CREATE OR REPLACE FUNCTION admin_create_user(phone text, full_name text, email text, staff boolean) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE me uuid := admin_bound('admin.users'); id uuid;
BEGIN
  INSERT INTO users (phone, full_name, email, is_staff, status, created_by, updated_by)
  VALUES (phone, full_name, email, coalesce(staff, false), 'active', me, me) RETURNING users.id INTO id;
  RETURN id;
END $$;
-- another account's profile (data-subject requests, corrections): never its phone, standing or credentials
CREATE OR REPLACE FUNCTION admin_update_profile(target uuid, patch jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE me uuid;
BEGIN
  IF app_is_system() THEN me := NULL;
  ELSIF app_holds('admin.users') OR app_holds('admin.notifications') OR app_holds('admin.clients.edit') THEN me := app_current_user();
    IF NOT app_bound_mfa() THEN RAISE EXCEPTION 'needs the second factor' USING ERRCODE = 'insufficient_privilege'; END IF;
  ELSE RAISE EXCEPTION 'needs admin.users, admin.notifications or admin.clients.edit' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF me IS NOT NULL AND target = me THEN RAISE EXCEPTION 'an administrator edits their own account from their own page' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(patch) k WHERE k NOT IN ('full_name', 'email', 'email_verified_at', 'deletion_requested_at', 'birth_date', 'national_id_enc', 'national_id_hash', 'id_type', 'phone', 'resides_in_ksa')) THEN
    RAISE EXCEPTION 'admin_update_profile: only profile fields' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE users SET
    full_name = CASE WHEN patch ? 'full_name' THEN patch->>'full_name' ELSE full_name END,
    email = CASE WHEN patch ? 'email' THEN patch->>'email' ELSE email END,
    email_verified_at = CASE WHEN patch ? 'email_verified_at' THEN (patch->>'email_verified_at')::timestamptz ELSE email_verified_at END,
    deletion_requested_at = CASE WHEN patch ? 'deletion_requested_at' THEN (patch->>'deletion_requested_at')::timestamptz ELSE deletion_requested_at END,
    birth_date = CASE WHEN patch ? 'birth_date' THEN (patch->>'birth_date')::date ELSE birth_date END,
    national_id_enc = CASE WHEN patch ? 'national_id_enc' THEN patch->>'national_id_enc' ELSE national_id_enc END,
    national_id_hash = CASE WHEN patch ? 'national_id_hash' THEN patch->>'national_id_hash' ELSE national_id_hash END,
    id_type = CASE WHEN patch ? 'id_type' THEN (patch->>'id_type')::id_type ELSE id_type END,
    -- a new phone is a new sign-in identifier: unverified until its next one-time code
    phone = CASE WHEN patch ? 'phone' THEN patch->>'phone' ELSE phone END,
    phone_verified_at = CASE WHEN patch ? 'phone' AND patch->>'phone' IS DISTINCT FROM phone THEN NULL ELSE phone_verified_at END,
    resides_in_ksa = CASE WHEN patch ? 'resides_in_ksa' THEN (patch->>'resides_in_ksa')::boolean ELSE resides_in_ksa END,
    updated_at = now(), updated_by = me
  WHERE id = target;
END $$;
-- a role's permissions (the matrix): only a bound holder of admin.roles; the other guards on role_permissions still run
CREATE OR REPLACE FUNCTION admin_set_role_permission(role_key text, perm_key text, grant_it boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE me uuid := admin_bound('admin.roles'); rid uuid; pid uuid; n integer;
BEGIN
  SELECT id INTO rid FROM roles WHERE key = role_key;
  SELECT id INTO pid FROM permissions WHERE key = perm_key;
  IF rid IS NULL OR pid IS NULL THEN RAISE EXCEPTION 'unknown role or permission'; END IF;
  IF grant_it THEN INSERT INTO role_permissions (role_id, permission_id) VALUES (rid, pid) ON CONFLICT DO NOTHING;
  ELSE DELETE FROM role_permissions WHERE role_id = rid AND permission_id = pid; END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;
-- a data-subject deletion carried out: the person is anonymized, their sessions end (records they appear in are kept)
CREATE OR REPLACE FUNCTION admin_anonymize_user(target uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE me uuid;
BEGIN
  IF app_is_system() THEN me := NULL;
  ELSIF app_holds('admin.notifications') AND app_bound_mfa() THEN me := app_current_user();
  ELSE RAISE EXCEPTION 'needs a bound holder of admin.notifications with the second factor' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF EXISTS (SELECT 1 FROM users WHERE id = target AND is_staff) THEN RAISE EXCEPTION 'a staff account is not anonymized here'; END IF;
  UPDATE users SET status = 'deleted', full_name = 'حساب محذوف', email = NULL, phone = 'deleted:' || id::text, password_hash = NULL,
    national_id_enc = NULL, national_id_hash = NULL, birth_date = NULL, mfa_enabled = false, updated_at = now(), updated_by = me WHERE id = target;
  DELETE FROM mfa_factors WHERE user_id = target;
  DELETE FROM recovery_codes WHERE user_id = target;
  UPDATE sessions SET revoked_at = now(), revoke_reason = 'account_deleted' WHERE user_id = target AND revoked_at IS NULL;
END $$;
-- what an administrator's page shows of another account's second factor: counts and dates, never secrets
CREATE OR REPLACE FUNCTION admin_mfa_state(target uuid)
RETURNS TABLE (factor_id uuid, kind text, verified_at timestamptz, last_used_at timestamptz, codes_total integer, codes_used integer) LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF NOT (app_is_system() OR app_is_staff()) THEN
    RAISE EXCEPTION 'staff only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY SELECT f.id, f.type::text, f.verified_at, f.last_used_at,
    (SELECT count(*)::int FROM recovery_codes c WHERE c.user_id = target), (SELECT count(*)::int FROM recovery_codes c WHERE c.user_id = target AND c.used_at IS NOT NULL)
  FROM mfa_factors f WHERE f.user_id = target
  UNION ALL SELECT NULL, NULL, NULL, NULL, (SELECT count(*)::int FROM recovery_codes c WHERE c.user_id = target), (SELECT count(*)::int FROM recovery_codes c WHERE c.user_id = target AND c.used_at IS NOT NULL)
  WHERE NOT EXISTS (SELECT 1 FROM mfa_factors f WHERE f.user_id = target);
END $$;
REVOKE ALL ON FUNCTION admin_set_role_permission(text, text, boolean), admin_anonymize_user(uuid), admin_mfa_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_set_role_permission(text, text, boolean), admin_anonymize_user(uuid), admin_mfa_state(uuid) TO waqfak_app;
REVOKE ALL ON FUNCTION admin_grant_role(uuid, text), admin_revoke_role(uuid, text), admin_set_standing(uuid, text, boolean, boolean), admin_create_user(text, text, text, boolean), admin_update_profile(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_grant_role(uuid, text), admin_revoke_role(uuid, text), admin_set_standing(uuid, text, boolean, boolean), admin_create_user(text, text, text, boolean), admin_update_profile(uuid, jsonb) TO waqfak_app;

-- ── Stage 11 / A: what the former «asSystem» steps read, as narrow functions that check the bound caller ──
-- (the system context no longer exists on the application's connection). Each returns only what its screen shows.
CREATE OR REPLACE FUNCTION app_can_see_request(rid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM service_requests r WHERE r.id = rid AND (
    app_is_system()
    OR (r.waqf_id IS NOT NULL AND app_can_access_waqf(r.waqf_id))
    OR (r.waqf_id IS NULL AND (app_has_global_access() OR r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user() OR r.created_by = app_current_user()))))
$$;
-- the last audit entry's id: a watermark (the entries written after it are this action's)
CREATE OR REPLACE FUNCTION app_audit_mark() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT coalesce(max(id), 0) FROM audit_logs
$$;
-- approved outputs of a waqf's deed services: their text is frozen; a change to the file is weighed against them
CREATE OR REPLACE FUNCTION app_waqf_frozen_outputs(w uuid, codes text[])
RETURNS TABLE (id uuid, number text, title text, request_id uuid, request_number text) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT o.id, o.number, o.title, o.request_id, r.number FROM outputs o JOIN service_requests r ON r.id = o.request_id JOIN services sv ON sv.id = r.service_id
   WHERE o.waqf_id = w AND o.status = 'approved' AND sv.code = ANY (codes) AND w IS NOT NULL AND app_can_access_waqf(w)
$$;
-- completeness counts of the waqfs the caller can see (no row data)
CREATE OR REPLACE FUNCTION app_waqf_completeness(ids uuid[])
RETURNS TABLE (id uuid, status text, archived boolean, deed boolean, assets integer, classes integer, trustees integer, board integer) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT w.id, w.status::text, (w.archived_at IS NOT NULL),
    EXISTS (SELECT 1 FROM documents d WHERE d.waqf_id = w.id AND d.doc_type = 'waqf_deed' AND d.status = 'active' AND d.archived_at IS NULL),
    (SELECT count(*)::int FROM assets a WHERE a.waqf_id = w.id AND a.archived_at IS NULL),
    (SELECT count(*)::int FROM beneficiary_classes c WHERE c.waqf_id = w.id),
    (SELECT count(*)::int FROM trustees t WHERE t.waqf_id = w.id AND t.status = 'active'),
    (SELECT count(*)::int FROM body_memberships m JOIN bodies b ON b.id = m.body_id
      WHERE b.waqf_id = w.id AND b.kind = 'board' AND coalesce(m.status, 'active') = 'active' AND (m.ends_on IS NULL OR m.ends_on >= current_date))
  FROM waqfs w WHERE w.id = ANY (ids) AND (app_can_access_waqf(w.id) OR (NOT app_waqf_has_members(w.id) AND w.created_by = app_current_user()))
$$;
-- the review state of a request's outputs, for the client's phase: status and delivered only
CREATE OR REPLACE FUNCTION app_request_output_states(ids uuid[])
RETURNS TABLE (request_id uuid, status text, delivered boolean) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT o.request_id, o.status::text, o.document_id IS NOT NULL FROM outputs o WHERE o.request_id = ANY (ids) AND app_can_see_request(o.request_id)
$$;
-- the corrections the team made to the client's own answers (and the client's completions): what, why, before, after
CREATE OR REPLACE FUNCTION app_request_client_revisions(rid uuid)
RETURNS TABLE (kind text, target text, at timestamptz, reason text, before jsonb, after jsonb) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT v.kind::text, v.target, v.at, v.reason, v.before, v.after FROM request_revisions v
   WHERE v.request_id = rid AND v.kind IN ('intake_edit', 'client_completion') AND app_can_see_request(rid) ORDER BY v.at
$$;
-- a client's reply to a completion item, applied to that one field of their own request: the previous value is kept
-- in a revision, the field goes to the team's review. The server validated the value against the form first.
CREATE OR REPLACE FUNCTION app_client_completion(rid uuid, field text, val jsonb, reason text, note text, at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE me uuid := app_current_user(); r service_requests; prev jsonb; ev jsonb;
BEGIN
  SELECT * INTO r FROM service_requests WHERE id = rid FOR UPDATE;
  IF me IS NULL OR r.id IS NULL OR NOT (r.requester_user_id = me OR (r.waqf_id IS NOT NULL AND app_can_access_waqf(r.waqf_id))) THEN
    RAISE EXCEPTION 'app_client_completion: not a party to this request' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF field IS NULL OR field !~ '^[A-Za-z0-9_.-]{1,80}$' THEN RAISE EXCEPTION 'app_client_completion: bad field'; END IF;
  prev := r.intake -> 'answers' -> field;
  UPDATE service_requests SET intake = jsonb_set(coalesce(intake, '{}'::jsonb), ARRAY['answers'], coalesce(intake -> 'answers', '{}'::jsonb) || jsonb_build_object(field, val), true),
    updated_by = me, updated_at = now() WHERE id = rid;
  INSERT INTO request_revisions (request_id, waqf_id, kind, target, reason, before, after, impact, actor_user_id)
  VALUES (rid, r.waqf_id, 'client_completion', field, reason, jsonb_build_object(field, prev), jsonb_build_object(field, val), '{}'::jsonb, me);
  ev := jsonb_build_object('at', at, 'by', me, 'action', 'changed', 'note', note, 'value', val);
  INSERT INTO request_field_states (request_id, waqf_id, field_key, status, note, history, updated_at)
  VALUES (rid, r.waqf_id, field, 'needs_review', note, jsonb_build_array(ev), now())
  ON CONFLICT (request_id, field_key) DO UPDATE SET status = 'needs_review', note = EXCLUDED.note, updated_at = now(),
    history = (SELECT coalesce(jsonb_agg(y.e ORDER BY y.n), '[]'::jsonb) FROM (SELECT x.e, x.n FROM jsonb_array_elements(request_field_states.history || EXCLUDED.history) WITH ORDINALITY x(e, n) ORDER BY x.n DESC LIMIT 50) y);
END $$;
REVOKE ALL ON FUNCTION app_client_completion(uuid, text, jsonb, text, text, timestamptz) FROM PUBLIC;
-- is a deed or national number already on record anywhere (no second file for a waqf) — yes or no, never whose
CREATE OR REPLACE FUNCTION app_waqf_number_taken(deed_norm text, nun text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT app_current_user() IS NOT NULL AND EXISTS (SELECT 1 FROM waqfs w WHERE (nun IS NOT NULL AND w.national_unified_number = nun)
    OR (deed_norm IS NOT NULL AND regexp_replace(lower(coalesce(w.deed_no, '')), '[[:space:]/-]', '', 'g') = deed_norm))
$$;
REVOKE ALL ON FUNCTION app_waqf_number_taken(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_waqf_number_taken(text, text) TO waqfak_app;
GRANT EXECUTE ON FUNCTION app_client_completion(uuid, text, jsonb, text, text, timestamptz) TO waqfak_app;
REVOKE ALL ON FUNCTION app_can_see_request(uuid), app_audit_mark(), app_waqf_frozen_outputs(uuid, text[]), app_waqf_completeness(uuid[]), app_request_output_states(uuid[]), app_request_client_revisions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_see_request(uuid), app_audit_mark(), app_waqf_frozen_outputs(uuid, text[]), app_waqf_completeness(uuid[]), app_request_output_states(uuid[]), app_request_client_revisions(uuid) TO waqfak_app;

-- ═════════════ Stage 11, B: the tables without row-level security; another person's data; the first member ═════════════
-- (classification: docs/stage-11/TABLES.md). Every one of the 52 tables that had no RLS is now in one of these:
--   identity — the authentication role's (A above);  personal — the person's own rows, staff, the system;
--   operational — the system's own (jobs, outbox, rate limits);  catalog — read by all, written by staff or the system.

-- ── N10-10: another person's contact and identity data. The application role reads a person's name and standing,
-- never their phone, e-mail, birth date or identity number — those through app_user_contact / app_user_private,
-- which answer only for oneself, an authorized staff member, or the manager of a waqf both belong to.
REVOKE SELECT ON users FROM waqfak_app;
GRANT SELECT (id, full_name, is_staff, status, locale, numeral_style, calendar_pref, mfa_enabled, created_at, updated_at, created_by, updated_by) ON users TO waqfak_app;
-- the system (notifications, jobs) reads the contact columns on its own grant
GRANT SELECT (id, phone, email, full_name, id_type, birth_date, locale, numeral_style, calendar_pref, status, is_staff, mfa_enabled, phone_verified_at, email_verified_at, locked_until, last_login_at, deletion_requested_at, resides_in_ksa, created_at, updated_at, created_by, updated_by) ON users TO waqfak_system;

CREATE OR REPLACE FUNCTION app_can_see_contact(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT target IS NOT NULL AND (
    app_is_system()
    OR target = app_current_user()
    OR (app_is_staff() AND (app_has_global_access() OR app_holds('admin.pii.view') OR app_holds('admin.users') OR app_holds('admin.clients.edit') OR app_holds('admin.notifications')))
    -- the manager of a waqf (a role carrying waqf.members.manage there) sees its members' and agents' contacts
    OR EXISTS (SELECT 1 FROM waqf_memberships mine JOIN roles r ON r.key = mine.role_key JOIN role_permissions rp ON rp.role_id = r.id
                 JOIN permissions p ON p.id = rp.permission_id AND p.key = 'waqf.members.manage'
               WHERE mine.user_id = app_current_user() AND mine.status = 'active' AND (mine.ends_at IS NULL OR mine.ends_at > now())
                 AND (EXISTS (SELECT 1 FROM waqf_memberships theirs WHERE theirs.waqf_id = mine.waqf_id AND theirs.user_id = target)
                      OR EXISTS (SELECT 1 FROM delegations d WHERE d.waqf_id = mine.waqf_id AND d.agent_user_id = target))))
$$;
CREATE OR REPLACE FUNCTION app_user_contact(ids uuid[]) RETURNS TABLE (id uuid, phone text, email text) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.id, u.phone, u.email FROM users u WHERE u.id = ANY (ids) AND app_can_see_contact(u.id)
$$;
-- the whole private record: oneself, or staff entitled to personal data (never another client)
CREATE OR REPLACE FUNCTION app_user_private(target uuid)
RETURNS TABLE (id uuid, phone text, email text, birth_date date, id_type text, national_id_enc text, resides_in_ksa boolean, phone_verified_at timestamptz,
               email_verified_at timestamptz, last_login_at timestamptz, locked_until timestamptz, failed_login_count integer, deletion_requested_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.id, u.phone, u.email, u.birth_date, u.id_type::text, u.national_id_enc, u.resides_in_ksa, u.phone_verified_at, u.email_verified_at, u.last_login_at,
         u.locked_until, u.failed_login_count, u.deletion_requested_at
    FROM users u WHERE u.id = target AND (app_is_system() OR u.id = app_current_user()
      OR (app_is_staff() AND (app_holds('admin.pii.view') OR app_holds('admin.users') OR app_holds('admin.clients.edit') OR app_holds('admin.notifications'))))
$$;
-- does an account hold this phone (an invitation, a delegation, a screening)? its id and name, never its other data
CREATE OR REPLACE FUNCTION app_user_by_phone(p text) RETURNS TABLE (id uuid, full_name text) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.id, u.full_name FROM users u WHERE u.phone = p AND (app_is_system() OR app_current_user() IS NOT NULL) LIMIT 1
$$;
-- staff search of accounts by name, phone or e-mail (lists and filters): ids only
CREATE OR REPLACE FUNCTION app_user_search(term text) RETURNS TABLE (id uuid) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.id FROM users u WHERE (app_is_system() OR app_is_staff()) AND length(coalesce(term, '')) >= 2
    AND (u.full_name ILIKE '%' || term || '%' OR u.email ILIKE '%' || term || '%' OR (length(regexp_replace(term, '\D', '', 'g')) >= 4 AND u.phone LIKE '%' || regexp_replace(term, '\D', '', 'g') || '%'))
$$;
-- an account by e-mail (sign-in identifier clashes, staff only)
CREATE OR REPLACE FUNCTION app_user_by_email(e text) RETURNS TABLE (id uuid) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.id FROM users u WHERE lower(u.email) = lower(e) AND (app_is_system() OR app_is_staff()) LIMIT 1
$$;
-- the administrative columns of many accounts at once (staff lists): staff entitled to personal data only
CREATE OR REPLACE FUNCTION app_user_admin_fields(ids uuid[])
RETURNS TABLE (id uuid, phone text, email text, last_login_at timestamptz, locked_until timestamptz, deletion_requested_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.id, u.phone, u.email, u.last_login_at, u.locked_until, u.deletion_requested_at FROM users u
   WHERE u.id = ANY (ids) AND (app_is_system() OR (app_is_staff() AND (app_holds('admin.pii.view') OR app_holds('admin.users') OR app_holds('admin.clients.edit') OR app_holds('admin.notifications'))))
$$;
REVOKE ALL ON FUNCTION app_user_by_email(text), app_user_admin_fields(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_user_by_email(text), app_user_admin_fields(uuid[]) TO waqfak_app;
REVOKE ALL ON FUNCTION app_can_see_contact(uuid), app_user_contact(uuid[]), app_user_private(uuid), app_user_by_phone(text), app_user_search(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_see_contact(uuid), app_user_contact(uuid[]), app_user_private(uuid), app_user_by_phone(text), app_user_search(text) TO waqfak_app;

-- ── N10-11: the first member of a waqf is its creator, for themselves, in the transaction that created it; nobody
-- makes themselves a member of a waqf without members (or of anyone's, without its managers)
DROP POLICY IF EXISTS wm_insert ON waqf_memberships;
CREATE POLICY wm_insert ON waqf_memberships FOR INSERT TO waqfak_app
  WITH CHECK (app_can_access_waqf(waqf_id) OR (
    NOT app_waqf_has_members(waqf_id) AND user_id = app_current_user()
    AND EXISTS (SELECT 1 FROM waqfs w WHERE w.id = waqf_id AND w.created_by = app_current_user() AND w.created_at = now())));
-- and a member is added to an existing waqf by someone who manages its members (or staff, or the system) —
-- not by any member: a beneficiary does not appoint a nazir
CREATE OR REPLACE FUNCTION app_can_manage_members(w uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT app_is_system() OR app_has_global_access()
    OR EXISTS (SELECT 1 FROM waqf_memberships mine JOIN roles r ON r.key = mine.role_key JOIN role_permissions rp ON rp.role_id = r.id
                 JOIN permissions p ON p.id = rp.permission_id AND p.key = 'waqf.members.manage'
               WHERE mine.waqf_id = w AND mine.user_id = app_current_user() AND mine.status = 'active' AND (mine.ends_at IS NULL OR mine.ends_at > now()))
$$;
REVOKE ALL ON FUNCTION app_can_manage_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_manage_members(uuid) TO waqfak_app;
DROP POLICY IF EXISTS wm_manage ON waqf_memberships;
CREATE POLICY wm_manage ON waqf_memberships AS RESTRICTIVE FOR INSERT TO waqfak_app
  WITH CHECK (app_can_manage_members(waqf_id) OR (
    NOT app_waqf_has_members(waqf_id) AND user_id = app_current_user()
    AND EXISTS (SELECT 1 FROM waqfs w WHERE w.id = waqf_id AND w.created_by = app_current_user() AND w.created_at = now()))
    -- an invitation accepted by its invitee (the invitation, not the invitee, names the role)
    OR EXISTS (SELECT 1 FROM invitations i WHERE i.waqf_id = waqf_memberships.waqf_id AND i.accepted_by = app_current_user()
                 AND waqf_memberships.user_id = app_current_user() AND i.role_key = waqf_memberships.role_key AND i.revoked_at IS NULL));

-- ── personal tables: the person's own rows, staff, the system ──
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('consents', 'user_id = app_current_user()', 'user_id = app_current_user()'),
      ('notification_preferences', 'user_id = app_current_user()', 'user_id = app_current_user()'),
      ('data_subject_requests', 'user_id = app_current_user()', 'user_id = app_current_user()'),
      ('payments', 'user_id = app_current_user()', 'false'),
      ('contract_signatures', 'user_id = app_current_user() OR EXISTS (SELECT 1 FROM contracts k WHERE k.id = contract_signatures.contract_id)', 'user_id = app_current_user()'),
      ('facts', 'EXISTS (SELECT 1 FROM assessments a WHERE a.id = facts.assessment_id)', 'EXISTS (SELECT 1 FROM assessments a WHERE a.id = facts.assessment_id)')
    ) AS x(tbl, own_read, own_write) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS personal_read ON %I', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS personal_write ON %I', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS personal_change ON %I', t.tbl);
    EXECUTE format('CREATE POLICY personal_read ON %I FOR SELECT TO waqfak_app USING (app_is_system() OR app_is_staff() OR %s)', t.tbl, t.own_read);
    EXECUTE format('CREATE POLICY personal_write ON %I FOR INSERT TO waqfak_app WITH CHECK (app_is_system() OR app_is_staff() OR %s)', t.tbl, t.own_write);
    EXECUTE format('CREATE POLICY personal_change ON %I FOR UPDATE TO waqfak_app USING (app_is_system() OR app_is_staff() OR %s) WITH CHECK (app_is_system() OR app_is_staff() OR %s)', t.tbl, t.own_write, t.own_write);
  END LOOP;
END $$;
-- deletions of personal rows: the system or staff only (a person withdraws a consent by a new row, never by erasing);
-- one's own notification preferences and an assessment's own facts are the exception
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['consents', 'data_subject_requests', 'payments', 'contract_signatures'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS personal_delete ON %I', t);
    EXECUTE format('CREATE POLICY personal_delete ON %I FOR DELETE TO waqfak_app USING (app_is_system() OR app_is_staff())', t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS personal_delete ON notification_preferences;
CREATE POLICY personal_delete ON notification_preferences FOR DELETE TO waqfak_app USING (app_is_system() OR app_is_staff() OR user_id = app_current_user());
DROP POLICY IF EXISTS personal_delete ON facts;
CREATE POLICY personal_delete ON facts FOR DELETE TO waqfak_app USING (app_is_system() OR app_is_staff() OR EXISTS (SELECT 1 FROM assessments a WHERE a.id = facts.assessment_id));

-- ── operational tables of the system: outbox, rate limits, job runs; contact messages (staff reads, the system writes)
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('outbox_messages', 'app_holds(''admin.notifications'') OR app_holds(''admin.settings'')'),
      ('rate_limits', 'app_holds(''admin.settings'')'),
      ('job_runs', 'app_is_staff()'),
      ('contact_messages', 'app_is_staff()')) AS x(tbl, staff) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS ops_access ON %I', t.tbl);
    EXECUTE format('CREATE POLICY ops_access ON %I FOR ALL TO waqfak_app USING (app_is_system() OR %s) WITH CHECK (app_is_system() OR %s)', t.tbl, t.staff, t.staff);
  END LOOP;
END $$;

-- ── unused by the application (no code path): the application role holds nothing on them; the system keeps them
REVOKE ALL ON kyc_records, organization_members, devices, persons, organizations FROM waqfak_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON kyc_records, organization_members, devices, persons, organizations TO waqfak_system;

-- ── catalogs and settings: read by everyone; written by staff (the action checks the exact permission) or the system
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['assessment_axes', 'assessment_questions', 'compliance_change_log', 'content_items', 'content_reviews', 'contract_templates',
      'critical_flag_defs', 'discounts', 'faqs', 'feature_flags', 'glossary_terms', 'holidays', 'needs', 'notification_templates', 'obligations',
      'package_items', 'packages', 'penalty_schedule', 'price_change_log', 'question_bank_versions', 'recommendation_rules', 'regulatory_references',
      'regulatory_requirements', 'service_categories', 'service_prices', 'services', 'settings', 'workflow_templates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS catalog_read ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS catalog_write ON %I', t);
    EXECUTE format('CREATE POLICY catalog_read ON %I FOR SELECT TO waqfak_app USING (true)', t);
    EXECUTE format('CREATE POLICY catalog_write ON %I FOR ALL TO waqfak_app USING (app_is_system() OR app_is_staff()) WITH CHECK (app_is_system() OR app_is_staff())', t);
  END LOOP;
END $$;
-- sequences: the numbering every writer advances (no person's data); left without RLS, documented in TABLES.md

-- ═════════════ Stage 11, C: what the engine wrote, the reference data, issued reports ═════════════
-- The registry of engine texts (N10-16): written by the engine's system connection only, read by the gate (a definer).
-- The application role holds nothing on it; the system may add and read, never change or remove.
REVOKE ALL ON engine_blocks FROM waqfak_app;
GRANT SELECT, INSERT ON engine_blocks TO waqfak_system;
ALTER TABLE engine_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eb_system ON engine_blocks;
CREATE POLICY eb_system ON engine_blocks FOR ALL TO waqfak_system USING (app_is_system()) WITH CHECK (app_is_system());

-- The reference data (texts, units, versions, comparisons, retrieval attempts) is loaded by the system (ingestion
-- scripts, the engine) and never written from a user session, whatever role the user holds: the application role
-- keeps reading it (policies above) and recording reviews of it (kb_source_reviews, ref_match_reviews, fiqh_reviews,
-- ref_version_confirmations), not the texts themselves.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON kb_sources, kb_chunks, ref_sources, ref_versions, ref_units, ref_match_runs, ref_fetch_attempts FROM waqfak_app;
GRANT SELECT, INSERT ON kb_sources, kb_chunks, ref_sources, ref_versions, ref_units, ref_match_runs, ref_fetch_attempts TO waqfak_system;
-- only a source's registry entry is re-recorded (ref_sources upsert) and a knowledge source superseded (kb_sources,
-- superseded_at alone: kb_source_guard); the texts, units, versions and comparisons are never updated
GRANT UPDATE ON kb_sources, ref_sources TO waqfak_system;
REVOKE UPDATE, DELETE, TRUNCATE ON kb_chunks, ref_versions, ref_units, ref_match_runs, ref_fetch_attempts FROM waqfak_system;

-- An issued report is what it was issued as: its kind, title, waqf, snapshot, assessment, document and issue never
-- change; a draft is approved once (draft → approved, by the bound user), and an approval is not withdrawn. A changed
-- report is a new report, with its own number and verification code.
CREATE OR REPLACE FUNCTION report_issue_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF current_user NOT IN ('waqfak_app', 'waqfak_system') THEN RETURN NEW; END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.title IS DISTINCT FROM OLD.title OR NEW.waqf_id IS DISTINCT FROM OLD.waqf_id
     OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.assessment_id IS DISTINCT FROM OLD.assessment_id
     OR NEW.document_id IS DISTINCT FROM OLD.document_id OR NEW.generated_by IS DISTINCT FROM OLD.generated_by
     OR NEW.generated_at IS DISTINCT FROM OLD.generated_at THEN
    RAISE EXCEPTION 'reports: an issued report does not change (issue a new one)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    IF NOT (OLD.status = 'draft' AND NEW.status = 'approved' AND OLD.approved_by IS NULL AND OLD.approved_at IS NULL
            AND NEW.approved_at IS NOT NULL AND NEW.approved_by IS NOT NULL
            AND (app_is_system() OR NEW.approved_by = app_current_user())) THEN
      RAISE EXCEPTION 'reports: a draft is approved once, by the approver in person; an approval is not withdrawn' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS report_issue_guard ON reports;
CREATE TRIGGER report_issue_guard BEFORE UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION report_issue_guard();

-- ═════════════ Phase 10 (owner's order of 2026-11-09), N9-1: no function resolves a name the caller can shadow ═════════════
-- A function body names tables and functions without a schema; PostgreSQL resolves them by search_path at each call,
-- and pg_temp — the caller's own temporary schema — is searched FIRST unless it is named. A definer function with
-- «search_path = public» therefore read a temporary «user_roles» or «sessions» created by the application role
-- (round 9, T1–T4). Every function of this schema — definer or invoker, guard or helper — now runs with
-- «pg_catalog, public, pg_temp»: the catalog, then this schema, and the caller's temporary schema LAST (where nothing
-- of ours is). Applied here, at the end, so that it covers every CREATE OR REPLACE above (which resets the setting),
-- and checked: the migration fails if any function is left without it.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
           WHERE n.nspname = 'public' AND l.lanname IN ('plpgsql', 'sql') AND pg_get_userbyid(p.proowner) = current_user LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public, pg_temp', f.sig);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
             WHERE n.nspname = 'public' AND l.lanname IN ('plpgsql', 'sql')
               AND NOT coalesce('search_path=pg_catalog, public, pg_temp' = ANY (p.proconfig), false)) THEN
    RAISE EXCEPTION 'security.sql: a function of schema public runs without search_path = pg_catalog, public, pg_temp';
  END IF;
END $$;
