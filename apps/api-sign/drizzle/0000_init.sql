CREATE TABLE "declarations" (
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"texts" jsonb NOT NULL,
	"test_only" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "declarations_key_version_pk" PRIMARY KEY("key","version")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"sha256" text PRIMARY KEY NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "envelope_events" (
	"envelope_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"event" text NOT NULL,
	"prev_sha256" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "envelope_events_envelope_id_seq_pk" PRIMARY KEY("envelope_id","seq")
);
--> statement-breakpoint
CREATE TABLE "envelopes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"document_sha256" text NOT NULL,
	"definition" text NOT NULL,
	"definition_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "envelopes_idempotency" UNIQUE("organisation_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "service_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_sha256" text NOT NULL,
	"allowed_origins" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "service_tokens_token_sha256_unique" UNIQUE("token_sha256")
);
--> statement-breakpoint
ALTER TABLE "envelope_events" ADD CONSTRAINT "envelope_events_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envelopes" ADD CONSTRAINT "envelopes_document_sha256_documents_sha256_fk" FOREIGN KEY ("document_sha256") REFERENCES "public"."documents"("sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "envelopes_organisation_idx" ON "envelopes" USING btree ("organisation_id");