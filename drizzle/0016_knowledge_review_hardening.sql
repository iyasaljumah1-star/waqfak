ALTER TABLE "kb_source_reviews" ADD COLUMN "chunk_id" uuid;--> statement-breakpoint
ALTER TABLE "kb_source_reviews" ADD COLUMN "reviewer_role" text NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_source_reviews" ADD CONSTRAINT "kb_source_reviews_chunk_id_kb_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."kb_chunks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_source_reviews" ADD CONSTRAINT "kb_source_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_source_reviews" ADD CONSTRAINT "kbsr_decision_ck" CHECK ("kb_source_reviews"."decision" in ('accepted', 'rejected'));--> statement-breakpoint
ALTER TABLE "kb_source_reviews" ADD CONSTRAINT "kbsr_role_ck" CHECK ("kb_source_reviews"."reviewer_role" in ('sharia', 'accounting', 'legal', 'data', 'investment'));--> statement-breakpoint
ALTER TABLE "kb_source_reviews" ADD CONSTRAINT "kbsr_note_ck" CHECK (length(trim("kb_source_reviews"."note")) >= 10);