-- Rollback of migrations 0010 (output quality) and 0011 (journey, assets, board) — LAST RESORT ONLY.
--
-- The previous app version runs on the migrated schema (verified in rehearsal), so the normal rollback is to redeploy
-- the previous image and keep the schema. Run this file only if the schema itself must go back, and only after taking
-- a fresh backup: it DELETES everything recorded since the deployment in the objects below (data conflicts, specialist
-- findings, official documentation records, asset details, board member capacity/contacts/status, governance rules text).
--
-- Usage (owner role):  psql "$DATABASE_OWNER_URL" -v ON_ERROR_STOP=1 -1 -f docs/deploy/rollback-0010-0011.sql
-- Rehearsed on a restore of the pre-0010 backup: the resulting schema equals the pre-migration schema.

-- security.sql (output quality section)
DROP TRIGGER IF EXISTS outputs_transition_guard ON outputs;
DROP FUNCTION IF EXISTS guard_output_transition();

-- 0011
ALTER TABLE assets DROP COLUMN IF EXISTS details;
ALTER TABLE body_memberships
  DROP COLUMN IF EXISTS capacity, DROP COLUMN IF EXISTS is_executive, DROP COLUMN IF EXISTS can_sign,
  DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS contact_email, DROP COLUMN IF EXISTS contact_phone,
  DROP COLUMN IF EXISTS appointment_ref, DROP COLUMN IF EXISTS appointment_document_id;
ALTER TABLE waqf_governance_profiles
  DROP COLUMN IF EXISTS competencies, DROP COLUMN IF EXISTS chair_powers, DROP COLUMN IF EXISTS delegation_limits,
  DROP COLUMN IF EXISTS task_allocation, DROP COLUMN IF EXISTS signing_rules, DROP COLUMN IF EXISTS coi_procedure,
  DROP COLUMN IF EXISTS records_rule, DROP COLUMN IF EXISTS source;

-- 0010 (tables carry their own indexes, policies and foreign keys)
DROP TABLE IF EXISTS data_conflicts;
DROP TABLE IF EXISTS output_reviews;
DROP TABLE IF EXISTS output_official_records;
ALTER TABLE regulatory_references DROP COLUMN IF EXISTS document_id;
ALTER TABLE output_versions DROP COLUMN IF EXISTS data_hash;

-- the migrator's ledger (sha256 of each migration file)
DELETE FROM drizzle.__drizzle_migrations WHERE hash IN (
  '8b355030642607175aba489411d781ecc111c13268ac2f996993cb9468daefe7', -- 0010_output_quality.sql
  'd08098e3d4e87f04e7b8ca9b83dab00e2d7d90177b24acafaffe5fb5f6c16631'  -- 0011_journey_assets_board.sql
);
