CREATE TABLE "output_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"output_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"version" integer NOT NULL,
	"origin" text NOT NULL,
	"based_on" integer,
	"sections" jsonb NOT NULL,
	"gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inputs_hash" text,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"task_id" uuid,
	"output_key" text NOT NULL,
	"title" text NOT NULL,
	"specialty" text NOT NULL,
	"review_policy" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"approved_version" integer,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"review_note" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"self_approved" boolean DEFAULT false NOT NULL,
	"document_id" uuid,
	"deliverable_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "request_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"waqf_id" uuid,
	"request_id" uuid,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor_user_id" uuid,
	"owner_user_id" uuid,
	"direct" boolean DEFAULT false NOT NULL,
	"note" text,
	"document_id" uuid,
	"output_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "stage_key" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "output_key" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "started_by" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "completed_by" uuid;--> statement-breakpoint
ALTER TABLE "output_versions" ADD CONSTRAINT "output_versions_output_id_outputs_id_fk" FOREIGN KEY ("output_id") REFERENCES "public"."outputs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outputs" ADD CONSTRAINT "outputs_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_links" ADD CONSTRAINT "request_links_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "output_versions_uq" ON "output_versions" USING btree ("output_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "outputs_number_uq" ON "outputs" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "outputs_req_key_uq" ON "outputs" USING btree ("request_id","output_key");--> statement-breakpoint
CREATE UNIQUE INDEX "request_links_uq" ON "request_links" USING btree ("request_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "request_links_entity_idx" ON "request_links" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "task_events_task_idx" ON "task_events" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_events_req_idx" ON "task_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "tasks_request_idx" ON "tasks" USING btree ("request_id");--> statement-breakpoint
-- Referential integrity for request-linked records. NOT VALID: enforced for every new or changed row without failing
-- the migration on legacy rows; scripts/audit-links.ts reports any legacy orphan for a documented fix.
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_request_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE restrict NOT VALID;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_request_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE restrict NOT VALID;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_request_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE set null NOT VALID;--> statement-breakpoint
ALTER TABLE "nazara_engagements" ADD CONSTRAINT "nazara_engagements_request_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE set null NOT VALID;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_request_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade NOT VALID;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_request_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE set null NOT VALID;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_waqf_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE restrict NOT VALID;--> statement-breakpoint
ALTER TABLE "outputs" ADD CONSTRAINT "outputs_task_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null;--> statement-breakpoint
-- One execution task per request, kind, stage and output: retries and refreshes never duplicate them.
CREATE UNIQUE INDEX "tasks_request_exec_uq" ON "tasks" USING btree ("request_id", "kind", coalesce("stage_key", ''), coalesce("output_key", '')) WHERE "request_id" IS NOT NULL AND "kind" IS NOT NULL;--> statement-breakpoint
-- Output versions and task events are history: never edited or deleted by the application.
CREATE OR REPLACE FUNCTION waqfak_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on % is not allowed', TG_OP, TG_TABLE_NAME;
END $$;--> statement-breakpoint
CREATE TRIGGER output_versions_append_only BEFORE UPDATE ON output_versions FOR EACH ROW EXECUTE FUNCTION waqfak_append_only();--> statement-breakpoint
CREATE TRIGGER task_events_append_only BEFORE UPDATE ON task_events FOR EACH ROW EXECUTE FUNCTION waqfak_append_only();--> statement-breakpoint
-- An approved output keeps its approved version, approver and document while it stays approved (a revision reopens
-- it as a draft; the previous approval stays in the versions, the audit log and the released document).
CREATE OR REPLACE FUNCTION waqfak_freeze_output() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'approved' AND NEW.status = 'approved' AND (NEW.approved_version IS DISTINCT FROM OLD.approved_version OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.output_key IS DISTINCT FROM OLD.output_key
    OR (OLD.document_id IS NOT NULL AND NEW.document_id IS DISTINCT FROM OLD.document_id)
    OR (OLD.deliverable_id IS NOT NULL AND NEW.deliverable_id IS DISTINCT FROM OLD.deliverable_id)) THEN
    RAISE EXCEPTION 'output % is approved; open a new revision instead', OLD.number;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER outputs_freeze BEFORE UPDATE ON outputs FOR EACH ROW EXECUTE FUNCTION waqfak_freeze_output();--> statement-breakpoint
-- Backfill: nazara files already opened by a request become its "origin" link (exact data, nothing inferred).
INSERT INTO "request_links" ("request_id", "waqf_id", "entity_type", "entity_id", "relation", "note", "created_by")
SELECT e."request_id", e."waqf_id", 'nazara_engagement', e."id", 'origin', 'ربط قائم قبل الترحيل', e."created_by"
FROM "nazara_engagements" e
WHERE e."request_id" IS NOT NULL AND EXISTS (SELECT 1 FROM "service_requests" r WHERE r."id" = e."request_id")
ON CONFLICT DO NOTHING;
