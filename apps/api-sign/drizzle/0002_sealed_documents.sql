CREATE TABLE "sealed_documents" (
	"envelope_id" uuid PRIMARY KEY NOT NULL,
	"sha256" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"trail_sha256" text NOT NULL,
	"certificate_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sealed_documents" ADD CONSTRAINT "sealed_documents_envelope_id_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A seal is evidence like the trail it was made over (0001): never updated, never removed.
CREATE TRIGGER sealed_documents_append_only BEFORE UPDATE OR DELETE ON sealed_documents
  FOR EACH ROW EXECUTE FUNCTION sign_refuse_change();
--> statement-breakpoint
CREATE TRIGGER sealed_documents_no_truncate BEFORE TRUNCATE ON sealed_documents
  FOR EACH STATEMENT EXECUTE FUNCTION sign_refuse_change();
