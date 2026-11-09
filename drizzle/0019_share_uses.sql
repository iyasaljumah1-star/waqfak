CREATE TABLE "document_share_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" uuid NOT NULL,
	"ip" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_share_uses" ADD CONSTRAINT "document_share_uses_share_id_document_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."document_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dsu_share_idx" ON "document_share_uses" USING btree ("share_id");