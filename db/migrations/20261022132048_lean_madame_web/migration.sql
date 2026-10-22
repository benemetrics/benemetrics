CREATE TABLE "alert_dead_letters" (
	"id" text PRIMARY KEY,
	"channel_id" text NOT NULL,
	"channel_name" text NOT NULL,
	"channel_type" text NOT NULL,
	"rule_id" text,
	"app_id" text,
	"notification" text NOT NULL,
	"error" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "alert_dead_letters_next_attempt_at_idx" ON "alert_dead_letters" ("next_attempt_at");