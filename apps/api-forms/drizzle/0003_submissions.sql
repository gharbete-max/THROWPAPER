CREATE TYPE "public"."submission_status" AS ENUM('partial', 'complete');--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"form_version_id" uuid NOT NULL,
	"event_id" uuid,
	"reference" text NOT NULL,
	"status" "submission_status" DEFAULT 'partial' NOT NULL,
	"locale" text NOT NULL,
	"email" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resume_token_hash" text,
	"resume_expires_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_form_version_id_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."form_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_org_reference_idx" ON "submissions" USING btree ("organisation_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_resume_token_idx" ON "submissions" USING btree ("resume_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_form_email_idx" ON "submissions" USING btree ("form_id","email") WHERE "submissions"."status" = 'complete' and "submissions"."email" is not null;--> statement-breakpoint
CREATE INDEX "submissions_form_status_idx" ON "submissions" USING btree ("form_id","status");