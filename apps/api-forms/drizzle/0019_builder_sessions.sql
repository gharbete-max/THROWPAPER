CREATE TABLE "builder_sessions" (
	"form_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"session" jsonb NOT NULL,
	"version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "builder_sessions_form_id_user_id_pk" PRIMARY KEY("form_id","user_id"),
	CONSTRAINT "builder_sessions_version_positive" CHECK ("builder_sessions"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "builder_sessions" ADD CONSTRAINT "builder_sessions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder_sessions" ADD CONSTRAINT "builder_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder_sessions" ADD CONSTRAINT "builder_sessions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;