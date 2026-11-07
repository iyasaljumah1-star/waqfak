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

-- ───────────── Processing engine and the final approval (owner's order of 2026-11-01, phase 2) ─────────────
-- Nothing of an output reaches the client before the system administrator's final approval, whatever the route.
-- The processing record (jobs, runs, steps) belongs to the team.
DROP POLICY IF EXISTS staff_only ON processing_runs;
CREATE POLICY staff_only ON processing_runs AS RESTRICTIVE FOR ALL TO waqfak_app USING (app_current_user() IS NULL OR app_is_staff()) WITH CHECK (app_current_user() IS NULL OR app_is_staff());
DROP POLICY IF EXISTS staff_only ON processing_steps;
CREATE POLICY staff_only ON processing_steps AS RESTRICTIVE FOR ALL TO waqfak_app USING (app_current_user() IS NULL OR app_is_staff()) WITH CHECK (app_current_user() IS NULL OR app_is_staff());
-- The client's submission queues the first job (written in the client's transaction); only staff read the queue.
DROP POLICY IF EXISTS staff_only ON processing_jobs;
CREATE POLICY staff_only ON processing_jobs AS RESTRICTIVE FOR SELECT TO waqfak_app USING (app_current_user() IS NULL OR app_is_staff());
DROP POLICY IF EXISTS staff_update ON processing_jobs;
CREATE POLICY staff_update ON processing_jobs AS RESTRICTIVE FOR UPDATE TO waqfak_app USING (app_current_user() IS NULL OR app_is_staff());
DROP POLICY IF EXISTS staff_delete ON processing_jobs;
CREATE POLICY staff_delete ON processing_jobs AS RESTRICTIVE FOR DELETE TO waqfak_app USING (app_current_user() IS NULL OR app_is_staff());

-- A delivery record exists for the client only once released: a cycle delivery once sent (released_at), any other one
-- once the request reached the client's side (legacy manual flow: awaiting the client's approval, completed, closed).
DROP POLICY IF EXISTS released_or_staff ON deliverables;
CREATE POLICY released_or_staff ON deliverables AS RESTRICTIVE FOR SELECT TO waqfak_app USING (
  app_current_user() IS NULL OR app_is_staff() OR released_at IS NOT NULL
  OR (cycle_id IS NULL AND status <> 'draft' AND EXISTS (
    SELECT 1 FROM service_requests r WHERE r.id = deliverables.request_id AND r.status IN ('awaiting_client_approval', 'completed', 'closed'))));

-- A deliverable file of a request is hidden from the client until it is approved (released), unless the client owns it.
DROP POLICY IF EXISTS unreleased_staff_only ON documents;
CREATE POLICY unreleased_staff_only ON documents AS RESTRICTIVE FOR SELECT TO waqfak_app USING (
  app_current_user() IS NULL OR app_is_staff() OR owner_user_id = app_current_user()
  OR NOT (doc_type = 'deliverable' AND request_id IS NOT NULL AND approval_status IS DISTINCT FROM 'approved'));

-- Team-side events of a request (output preparation, approvals, engine steps) are never read by the client.
DROP POLICY IF EXISTS internal_staff_only ON request_events;
CREATE POLICY internal_staff_only ON request_events AS RESTRICTIVE FOR SELECT TO waqfak_app USING (
  internal = false OR app_current_user() IS NULL OR app_is_staff());

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
  USING (waqf_id IS NOT NULL OR app_current_user() IS NULL OR app_has_global_access() OR EXISTS (SELECT 1 FROM service_requests r WHERE r.id = request_field_states.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user())))
  WITH CHECK (waqf_id IS NOT NULL OR app_current_user() IS NULL OR app_has_global_access() OR EXISTS (SELECT 1 FROM service_requests r WHERE r.id = request_field_states.request_id AND (r.requester_user_id = app_current_user() OR r.assigned_to_user_id = app_current_user())));
DROP POLICY IF EXISTS staff_insert ON request_field_states;
CREATE POLICY staff_insert ON request_field_states AS RESTRICTIVE FOR INSERT TO waqfak_app WITH CHECK (app_current_user() IS NULL OR app_is_staff());
DROP POLICY IF EXISTS staff_update ON request_field_states;
CREATE POLICY staff_update ON request_field_states AS RESTRICTIVE FOR UPDATE TO waqfak_app USING (app_current_user() IS NULL OR app_is_staff()) WITH CHECK (app_current_user() IS NULL OR app_is_staff());
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
    EXECUTE format('CREATE POLICY kb_read ON %I FOR SELECT TO waqfak_app USING (app_has_global_access() OR app_current_user() IS NULL OR app_is_staff())', t);
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
  IF app_current_user() IS NULL THEN RETURN coalesce(NEW, OLD); END IF;
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
  IF app_current_user() IS NULL THEN RETURN coalesce(NEW, OLD); END IF;
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
  IF app_current_user() IS NOT NULL THEN
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
  IF app_current_user() IS NOT NULL AND app_current_user() = OLD.id THEN
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
CREATE OR REPLACE FUNCTION app_review_session(reviewer uuid) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE tok text := nullif(current_setting('app.session_token', true), ''); sid uuid;
BEGIN
  IF tok IS NULL OR reviewer IS NULL THEN RETURN NULL; END IF;
  SELECT s.id INTO sid FROM sessions s JOIN users u ON u.id = s.user_id
   WHERE s.token_hash = encode(sha256(convert_to(tok, 'UTF8')), 'hex') AND s.user_id = reviewer
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
    EXECUTE format('CREATE POLICY fiqh_read ON %I FOR SELECT TO waqfak_app USING (app_current_user() IS NULL OR app_is_staff())', t);
    EXECUTE format('DROP TRIGGER IF EXISTS ref_append_only ON %I', t);
    EXECUTE format('CREATE TRIGGER ref_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION ref_append_only()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS ref_no_truncate ON %I', t);
    EXECUTE format('CREATE TRIGGER ref_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION ref_append_only()', t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM waqfak_app', t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS fiqh_dossier_insert ON fiqh_dossiers;
CREATE POLICY fiqh_dossier_insert ON fiqh_dossiers FOR INSERT TO waqfak_app WITH CHECK (app_current_user() IS NULL OR app_is_staff());
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
CREATE OR REPLACE FUNCTION output_unreviewed_basis(oid uuid, ver integer) RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer := 0; secs jsonb;
BEGIN
  SELECT sections INTO secs FROM output_versions WHERE output_id = oid AND version = ver;
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
  SELECT n + count(*) INTO n FROM (
    SELECT DISTINCT (b->>'dossierId')::uuid AS did FROM jsonb_path_query(secs, '$[*] ? (!(exists(@.removed)) || @.removed != true).blocks[*] ? (@.type == "specialist" && exists(@.dossierId))') b
  ) x JOIN fiqh_dossiers d ON d.id = x.did
  WHERE NOT EXISTS (
    SELECT 1 FROM fiqh_reviews f JOIN held h ON h.user_id = f.reviewer_user_id AND h.role = f.reviewer_role
    WHERE f.dossier_id = d.id AND f.dossier_sha256 = d.sha256 AND f.decision IN ('approved', 'modified') AND f.session_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM fiqh_reviews later WHERE later.dossier_id = d.id AND later.at > f.at));
  RETURN n;
END $$;
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
  IF app_current_user() IS NOT NULL AND app_current_user() <> OLD.id
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
  IF session_user = 'waqfak_app' AND app_current_user() IS NULL AND TG_OP <> 'DELETE' THEN
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
