CREATE TABLE "billing_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"address" text,
	"reference" text,
	"locale" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charge_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" jsonb NOT NULL,
	"default_unit_amount_minor" bigint NOT NULL,
	"vat_rate_basis_points" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipient_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"charge_type_id" uuid NOT NULL,
	"unit_amount_minor" bigint,
	"quantity_thousandths" bigint DEFAULT 1000 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_recipients" ADD CONSTRAINT "billing_recipients_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_types" ADD CONSTRAINT "charge_types_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipient_charges" ADD CONSTRAINT "recipient_charges_recipient_id_billing_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."billing_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipient_charges" ADD CONSTRAINT "recipient_charges_charge_type_id_charge_types_id_fk" FOREIGN KEY ("charge_type_id") REFERENCES "public"."charge_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_recipients_org_idx" ON "billing_recipients" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_recipients_org_reference_idx" ON "billing_recipients" USING btree ("organisation_id","reference") WHERE reference is not null;--> statement-breakpoint
CREATE INDEX "charge_types_org_idx" ON "charge_types" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "recipient_charges_recipient_idx" ON "recipient_charges" USING btree ("recipient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipient_charges_unique_idx" ON "recipient_charges" USING btree ("recipient_id","charge_type_id");