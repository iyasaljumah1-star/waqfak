-- Read-only checks to run on production BEFORE migrations 0010/0011 (no writes). Expected results are in docs/DEPLOY-REVIEW.md.

-- 1. Server version (needs 13+; gen_random_uuid, jsonb_path_*)
SELECT current_setting('server_version_num')::int AS server_version_num;

-- 2. Applied migrations: expect 10 (0000–0009) and none of 0010/0011
SELECT count(*) AS applied FROM drizzle.__drizzle_migrations;

-- 3. Objects that must not exist yet (all NULL / false)
SELECT to_regclass('public.data_conflicts') AS data_conflicts, to_regclass('public.output_reviews') AS output_reviews,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assets' AND column_name = 'details') AS assets_details;

-- 4. Outputs the new transition guard will hold at their next status change (in review with blocking gaps or unwritten
--    specialist parts in their current version). They are not altered; they cannot be approved until completed.
SELECT o.id, o.status, o.current_version
FROM outputs o JOIN output_versions v ON v.output_id = o.id AND v.version = o.current_version
WHERE o.status = 'in_review'
  AND (jsonb_path_exists(v.gaps, '$[*] ? (@.severity == "blocking")')
       OR jsonb_path_exists(v.sections, '$[*].blocks[*] ? (@.type == "specialist" && @.text like_regex "^\\s*$")'));

-- 5. W01 requests still being filled on the v2 form (they will be asked the will type when next saved)
SELECT r.id, r.number, r.status, r.intake_form_version
FROM service_requests r JOIN services s ON s.id = r.service_id
WHERE s.code = 'W01' AND coalesce(r.intake_form_version, 0) < 3 AND r.status IN ('draft', 'awaiting_client');

-- 6. Table sizes touched by ALTER TABLE (lock is brief: ADD COLUMN with a constant default does not rewrite the table)
SELECT relname, n_live_tup FROM pg_stat_user_tables
WHERE relname IN ('assets', 'body_memberships', 'waqf_governance_profiles', 'regulatory_references', 'output_versions', 'outputs', 'service_requests');
