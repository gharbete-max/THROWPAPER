CREATE TABLE "builder_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"phrase" text NOT NULL,
	"key" text NOT NULL,
	"node_id" text NOT NULL,
	"option_id" text NOT NULL,
	"locale" text NOT NULL,
	"source" text NOT NULL,
	"created_on" date NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	CONSTRAINT "builder_aliases_source" CHECK ("builder_aliases"."source" in ('user-confirmed', 'imported')),
	CONSTRAINT "builder_aliases_count_positive" CHECK ("builder_aliases"."count" > 0)
);
--> statement-breakpoint
ALTER TABLE "builder_aliases" ADD CONSTRAINT "builder_aliases_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "builder_aliases_said_idx" ON "builder_aliases" USING btree ("organisation_id","locale","node_id","key");