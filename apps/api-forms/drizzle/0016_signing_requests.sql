CREATE TABLE "signing_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"envelope_id" text NOT NULL,
	"document_name" text NOT NULL,
	"source" text NOT NULL,
	"submission_id" uuid,
	"environment" text NOT NULL,
	"status" text NOT NULL,
	"parties" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signing_requests" ADD CONSTRAINT "signing_requests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signing_requests_org_idx" ON "signing_requests" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "signing_requests_envelope_idx" ON "signing_requests" USING btree ("envelope_id");