-- One brand kit per organisation. The row is optional: no row means the shipped defaults apply,
-- which is why nothing needs backfilling here.
CREATE TABLE IF NOT EXISTS "brand_kits" (
  "organisation_id" uuid PRIMARY KEY NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "tokens" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE set null
);
