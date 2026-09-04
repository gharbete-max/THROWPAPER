CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued', 'sent', 'paid', 'cancelled');--> statement-breakpoint
CREATE TABLE "invoice_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"sent_at" timestamp with time zone,
	"last_test_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" jsonb NOT NULL,
	"quantity_thousandths" bigint NOT NULL,
	"unit_amount_minor" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"vat_rate_basis_points" integer DEFAULT 0 NOT NULL,
	"vat_minor" bigint NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"batch_id" uuid,
	"number" integer NOT NULL,
	"ocr" text NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'SEK' NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_email" text,
	"recipient_address" text,
	"recipient_reference" text,
	"subject" jsonb NOT NULL,
	"period_start" date,
	"period_end" date,
	"issued_on" date NOT NULL,
	"due_on" date NOT NULL,
	"net_minor" bigint NOT NULL,
	"vat_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"payment_method" text NOT NULL,
	"payment_account" text NOT NULL,
	"public_token" text NOT NULL,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_total_is_net_plus_vat" CHECK ("invoices"."total_minor" = "invoices"."net_minor" + "invoices"."vat_minor"),
	CONSTRAINT "invoices_due_not_before_issue" CHECK ("invoices"."due_on" >= "invoices"."issued_on")
);
--> statement-breakpoint
ALTER TABLE "journal_lines" ALTER COLUMN "debit_minor" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "journal_lines" ALTER COLUMN "credit_minor" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "invoice_batches" ADD CONSTRAINT "invoice_batches_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_batches" ADD CONSTRAINT "invoice_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_batch_id_invoice_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."invoice_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_batches_org_idx" ON "invoice_batches" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_ocr_idx" ON "invoices" USING btree ("organisation_id","ocr");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_number_idx" ON "invoices" USING btree ("organisation_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_public_token_idx" ON "invoices" USING btree ("public_token");--> statement-breakpoint
CREATE INDEX "invoices_org_status_idx" ON "invoices" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "invoices_batch_idx" ON "invoices" USING btree ("batch_id");