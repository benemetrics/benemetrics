CREATE TABLE "issues" (
	"id" text PRIMARY KEY,
	"app_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'unresolved' NOT NULL,
	"event_count" integer DEFAULT 1 NOT NULL,
	"first_seen" text NOT NULL,
	"last_seen" text NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_incidents" ADD COLUMN "trigger" text DEFAULT 'threshold' NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_incidents" ADD COLUMN "issue_fingerprint" text;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD COLUMN "trigger" text DEFAULT 'threshold' NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_incidents" ALTER COLUMN "metric" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_incidents" ALTER COLUMN "value" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_incidents" ALTER COLUMN "threshold" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_rules" ALTER COLUMN "metric" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_rules" ALTER COLUMN "operator" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_rules" ALTER COLUMN "threshold" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_rules" ALTER COLUMN "window_seconds" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "issues_app_id_idx" ON "issues" ("app_id");--> statement-breakpoint
CREATE INDEX "issues_status_idx" ON "issues" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_app_fingerprint_idx" ON "issues" ("app_id","fingerprint");