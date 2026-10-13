CREATE TABLE "campaign_suppressions" (
	"organisation_id" uuid NOT NULL,
	"email" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_suppressions_organisation_id_email_pk" PRIMARY KEY("organisation_id","email")
);
--> statement-breakpoint
ALTER TABLE "campaign_suppressions" ADD CONSTRAINT "campaign_suppressions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;