-- Rollback of migration 0012 (field review) — LAST RESORT ONLY.
--
-- 0012 is additive (one new table, three nullable columns): the previous app version runs on the migrated schema, so the
-- normal rollback is to redeploy the previous image and keep the schema. Run this file only if the schema itself must go
-- back, and only after a fresh backup: it DELETES what was recorded since the deployment in these objects (field review
-- states and their history, the field link of notes and tasks, output data snapshots). Notes and tasks themselves stay.
--
-- Usage (owner role):  psql "$DATABASE_OWNER_URL" -v ON_ERROR_STOP=1 -1 -f docs/deploy/rollback-0012.sql

-- the table carries its own index, policies and foreign key
DROP TABLE IF EXISTS request_field_states;
ALTER TABLE request_notes DROP COLUMN IF EXISTS field_key;
ALTER TABLE tasks DROP COLUMN IF EXISTS field_key;
ALTER TABLE output_versions DROP COLUMN IF EXISTS data_snapshot;

-- the migrator's ledger (sha256 of the migration file)
DELETE FROM drizzle.__drizzle_migrations WHERE hash = '565760884d2115ffe4c083359699c296a48f638a7c5c5c3f8f2616dec505feb2'; -- 0012_field_review.sql
