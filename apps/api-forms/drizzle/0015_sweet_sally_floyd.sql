DROP INDEX "check_ins_submission_idx";--> statement-breakpoint
ALTER TABLE "check_ins" ADD COLUMN "entry_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "check_ins_submission_idx" ON "check_ins" USING btree ("submission_id","entry_index");