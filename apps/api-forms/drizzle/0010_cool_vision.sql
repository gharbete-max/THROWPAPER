CREATE TYPE "public"."form_share_role" AS ENUM('viewer', 'editor');--> statement-breakpoint
CREATE TABLE "form_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "form_share_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "form_shares" ADD CONSTRAINT "form_shares_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_shares" ADD CONSTRAINT "form_shares_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_shares" ADD CONSTRAINT "form_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_shares_form_user_idx" ON "form_shares" USING btree ("form_id","user_id");--> statement-breakpoint
CREATE INDEX "form_shares_user_idx" ON "form_shares" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "forms_owner_idx" ON "forms" USING btree ("organisation_id","owner_user_id");