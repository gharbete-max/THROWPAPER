ALTER TABLE "declarations" DROP CONSTRAINT "declarations_key_version_pk";--> statement-breakpoint
ALTER TABLE "declarations" ADD COLUMN "organisation_id" uuid;--> statement-breakpoint
ALTER TABLE "declarations" ADD CONSTRAINT "declarations_owner_key_version" UNIQUE NULLS NOT DISTINCT("organisation_id","key","version");