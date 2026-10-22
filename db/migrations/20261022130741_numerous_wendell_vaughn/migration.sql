ALTER TABLE "alert_incidents" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alert_incidents" ADD COLUMN "acknowledged_by" text;--> statement-breakpoint
ALTER TABLE "alert_incidents" ADD COLUMN "assignee" text;