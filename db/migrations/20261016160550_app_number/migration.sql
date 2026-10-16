ALTER TABLE "apps" ADD COLUMN "number" serial;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_number_key" UNIQUE("number");