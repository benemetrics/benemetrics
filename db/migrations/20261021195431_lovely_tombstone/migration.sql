CREATE TABLE "permission_grants" (
	"id" text PRIMARY KEY,
	"identity_id" text NOT NULL,
	"label" text,
	"environments" text DEFAULT '[]' NOT NULL,
	"app_prefixes" text DEFAULT '[]' NOT NULL,
	"is_enabled" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission_rules" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"environments" text DEFAULT '[]' NOT NULL,
	"app_prefixes" text DEFAULT '[]' NOT NULL,
	"is_enabled" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "permission_grants_identity_id_idx" ON "permission_grants" ("identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_rules_name_idx" ON "permission_rules" ("name");