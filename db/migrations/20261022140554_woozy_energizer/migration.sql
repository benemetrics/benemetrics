CREATE TABLE "alert_rule_history" (
	"id" text PRIMARY KEY,
	"rule_id" text NOT NULL,
	"name" text NOT NULL,
	"action" text NOT NULL,
	"snapshot" text NOT NULL,
	"actor" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_incidents" ADD COLUMN "correlation_key" text;--> statement-breakpoint
ALTER TABLE "alert_incidents" ADD COLUMN "parent_id" text;--> statement-breakpoint
CREATE INDEX "alert_rule_history_rule_id_idx" ON "alert_rule_history" ("rule_id");