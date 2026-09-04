CREATE TYPE "public"."charge_unit" AS ENUM('each', 'square_metre', 'month', 'hour');--> statement-breakpoint
ALTER TABLE "billing_recipients" ADD COLUMN "floor_area_thousandths" bigint;--> statement-breakpoint
ALTER TABLE "charge_types" ADD COLUMN "unit" charge_unit DEFAULT 'each' NOT NULL;