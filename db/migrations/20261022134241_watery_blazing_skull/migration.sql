CREATE TABLE "alert_silences" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"scope_type" text DEFAULT 'global' NOT NULL,
	"scope_id" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"reason" text,
	"created_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "alert_silences_scope_idx" ON "alert_silences" ("scope_type","scope_id");