CREATE TABLE "engine_blocks" (
	"binding" text PRIMARY KEY NOT NULL,
	"text_sha256" text NOT NULL,
	"run_id" uuid NOT NULL,
	"writer" text NOT NULL,
	"output_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eb_writer_ck" CHECK ("engine_blocks"."writer" in ('model', 'template'))
);
--> statement-breakpoint
CREATE INDEX "eb_text_idx" ON "engine_blocks" USING btree ("text_sha256");