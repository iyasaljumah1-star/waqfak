CREATE TABLE "payment_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"quote_id" uuid NOT NULL,
	"contract_id" uuid,
	"term_key" text NOT NULL,
	"label" text NOT NULL,
	"percent" text NOT NULL,
	"net" text NOT NULL,
	"vat" text NOT NULL,
	"total" text NOT NULL,
	"due_kind" text NOT NULL,
	"due_on" date,
	"milestone" text,
	"before_start" boolean DEFAULT false NOT NULL,
	"series" text,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alerts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "delivery_schedule" jsonb;--> statement-breakpoint
ALTER TABLE "service_cycles" ADD COLUMN "viewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_cycles" ADD COLUMN "client_decision" text;--> statement-breakpoint
ALTER TABLE "service_cycles" ADD COLUMN "client_decision_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_cycles" ADD COLUMN "client_decision_by" uuid;--> statement-breakpoint
ALTER TABLE "service_cycles" ADD COLUMN "client_decision_note" text;--> statement-breakpoint
ALTER TABLE "service_cycles" ADD COLUMN "client_approved_version" integer;--> statement-breakpoint
ALTER TABLE "service_cycles" ADD COLUMN "client_events" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "service_terms" ADD COLUMN "custom_dates" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "service_terms" ADD COLUMN "client_acceptance" text DEFAULT 'required' NOT NULL;--> statement-breakpoint
ALTER TABLE "service_terms" ADD COLUMN "cadence_source" text;--> statement-breakpoint
ALTER TABLE "payment_schedule" ADD CONSTRAINT "payment_schedule_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_schedule_quote_term_uq" ON "payment_schedule" USING btree ("quote_id","term_key");--> statement-breakpoint
CREATE INDEX "payment_schedule_due_idx" ON "payment_schedule" USING btree ("due_on");--> statement-breakpoint
INSERT INTO "notification_templates" ("key", "title_ar", "body_ar", "severity", "channels") VALUES
  ('delivery.available', 'تسليم جديد متاح في طلبك {number}', '{title}. اطّلع عليه في صفحة الطلب ثم اعتمده أو اطلب تعديله.', 'important', '["in_app"]'::jsonb),
  ('delivery.client_decision', 'رد العميل على تسليم في الطلب {number}', '{decision}: {title}. {note}', 'important', '["in_app"]'::jsonb),
  ('delivery.response_overdue', 'تسليم بانتظار ردك في الطلب {number}', '{title} متاح منذ {days} يومًا ولم يُعتمد أو يُطلب تعديله.', 'info', '["in_app"]'::jsonb),
  ('billing.installment_due', 'استحقاق دفعة: {label} — {number}', '{stage}. المبلغ {amount}، والاستحقاق {due}. لا تُصدر فاتورة تلقائيًا: أعدّ مسودتها من صفحة الطلب.', 'important', '["in_app"]'::jsonb)
ON CONFLICT ("key") DO NOTHING;
