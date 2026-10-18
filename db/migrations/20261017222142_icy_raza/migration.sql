CREATE TABLE "permission_rules" (
	"id" text PRIMARY KEY,
	"group_name" text NOT NULL,
	"environments" text DEFAULT '[]' NOT NULL,
	"app_prefixes" text DEFAULT '[]' NOT NULL,
	"is_enabled" integer DEFAULT 1 NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission_users" (
	"id" text PRIMARY KEY,
	"email" text NOT NULL,
	"environments" text DEFAULT '[]' NOT NULL,
	"app_prefixes" text DEFAULT '[]' NOT NULL,
	"is_enabled" integer DEFAULT 1 NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "permission_rules_group_name_idx" ON "permission_rules" ("group_name");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_users_email_idx" ON "permission_users" ("email");