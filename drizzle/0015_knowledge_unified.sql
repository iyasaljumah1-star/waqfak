CREATE TABLE "kb_source_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"note" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "kbs_ref_version_uq";--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD COLUMN "paragraph_no" integer;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD COLUMN "page_file" integer;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD COLUMN "page_printed" text;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD COLUMN "text_origin" text DEFAULT 'text_layer' NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_sources" ADD COLUMN "ref_kind" text DEFAULT 'unclassified' NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_sources" ADD COLUMN "registry_id" text;--> statement-breakpoint
ALTER TABLE "kb_sources" ADD COLUMN "registry_snapshot" text;--> statement-breakpoint
ALTER TABLE "kb_sources" ADD COLUMN "edition" text;--> statement-breakpoint
ALTER TABLE "kb_sources" ADD COLUMN "published_on" date;--> statement-breakpoint
ALTER TABLE "kb_sources" ADD COLUMN "repealed_on" date;--> statement-breakpoint
ALTER TABLE "kb_sources" ADD COLUMN "services" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_sources" ADD COLUMN "meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_source_reviews" ADD CONSTRAINT "kb_source_reviews_source_id_kb_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."kb_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kbsr_source_idx" ON "kb_source_reviews" USING btree ("source_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "kbs_ref_version_sha_uq" ON "kb_sources" USING btree ("ref_code","version","sha256");--> statement-breakpoint
CREATE INDEX "kbs_ref_idx" ON "kb_sources" USING btree ("ref_code");