CREATE TABLE "permission_audit" (
	"id" text PRIMARY KEY,
	"actor_id" text NOT NULL,
	"target" text NOT NULL,
	"target_id" text NOT NULL,
	"action" text NOT NULL,
	"before" text DEFAULT 'null' NOT NULL,
	"after" text DEFAULT 'null' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "permission_audit_target_idx" ON "permission_audit" ("target","target_id");--> statement-breakpoint
CREATE INDEX "permission_audit_created_at_idx" ON "permission_audit" ("created_at");