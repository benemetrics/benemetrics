CREATE TABLE "alert_channels" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" text DEFAULT '{}' NOT NULL,
	"app_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_incidents" (
	"id" text PRIMARY KEY,
	"rule_id" text NOT NULL,
	"app_id" text,
	"trigger" text DEFAULT 'threshold' NOT NULL,
	"issue_fingerprint" text,
	"metric" text,
	"value" real,
	"threshold" real,
	"status" text DEFAULT 'firing' NOT NULL,
	"triggered_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "alert_incidents_trigger_check" CHECK ("trigger" in ('threshold', 'new_issue', 'regression')),
	CONSTRAINT "alert_incidents_status_check" CHECK ("status" in ('firing', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"trigger" text DEFAULT 'threshold' NOT NULL,
	"metric" text,
	"operator" text,
	"threshold" real,
	"window_seconds" integer,
	"cooldown_seconds" integer DEFAULT 3600 NOT NULL,
	"channel_ids" text DEFAULT '[]' NOT NULL,
	"measurement" text,
	"app_id" text,
	"is_enabled" integer DEFAULT 1 NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_rules_trigger_check" CHECK ("trigger" in ('threshold', 'new_issue', 'regression'))
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"id" text PRIMARY KEY,
	"number" serial UNIQUE,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"name" text NOT NULL,
	"platform" text DEFAULT 'javascript' NOT NULL,
	"ingest_key" text NOT NULL UNIQUE,
	"public_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_default" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiment_assignments" (
	"id" text PRIMARY KEY,
	"flag_id" text NOT NULL,
	"user_id" text NOT NULL,
	"variant_key" text NOT NULL,
	"context" text DEFAULT '{}' NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiment_metrics" (
	"id" text PRIMARY KEY,
	"flag_id" text NOT NULL,
	"variant_key" text NOT NULL,
	"user_id" text NOT NULL,
	"metric_name" text NOT NULL,
	"value" real DEFAULT 1 NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" text PRIMARY KEY,
	"key" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"description" text DEFAULT '',
	"type" text NOT NULL,
	"default_value" text NOT NULL,
	"variants" text DEFAULT '[]' NOT NULL,
	"targeting_rules" text DEFAULT '[]' NOT NULL,
	"segments" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"rollout_percentage" integer DEFAULT 100 NOT NULL,
	"experiment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" text PRIMARY KEY,
	"app_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"title" text NOT NULL,
	"culprit" text,
	"level" text DEFAULT 'error' NOT NULL,
	"type" text DEFAULT 'message' NOT NULL,
	"first_release" text,
	"last_release" text,
	"status" text DEFAULT 'unresolved' NOT NULL,
	"event_count" integer DEFAULT 1 NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"latest_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"description" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" text PRIMARY KEY,
	"app_id" text NOT NULL,
	"version" text NOT NULL,
	"ref" text,
	"url" text,
	"owner" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"first_seen" timestamp with time zone,
	"last_seen" timestamp with time zone,
	"event_count" integer DEFAULT 0 NOT NULL,
	"latest_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"description" text DEFAULT '',
	"rules" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_map_tokens" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"app_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "source_maps" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"app_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"release" text NOT NULL,
	"dist" text,
	"filename" text NOT NULL,
	"map_json" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "alert_channels_app_id_idx" ON "alert_channels" ("app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_channels_scope_name_idx" ON "alert_channels" ("app_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_channels_global_name_idx" ON "alert_channels" ("name") WHERE "app_id" is null;--> statement-breakpoint
CREATE INDEX "alert_incidents_rule_id_idx" ON "alert_incidents" ("rule_id");--> statement-breakpoint
CREATE INDEX "alert_incidents_app_id_idx" ON "alert_incidents" ("app_id");--> statement-breakpoint
CREATE INDEX "alert_incidents_status_idx" ON "alert_incidents" ("status");--> statement-breakpoint
CREATE INDEX "alert_rules_app_id_idx" ON "alert_rules" ("app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_rules_scope_name_idx" ON "alert_rules" ("app_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_rules_global_name_idx" ON "alert_rules" ("name") WHERE "app_id" is null;--> statement-breakpoint
CREATE INDEX "apps_project_id_idx" ON "apps" ("project_id");--> statement-breakpoint
CREATE INDEX "apps_ingest_key_idx" ON "apps" ("ingest_key");--> statement-breakpoint
CREATE INDEX "environments_project_id_idx" ON "environments" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_project_slug_idx" ON "environments" ("project_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_one_default_idx" ON "environments" ("project_id") WHERE "is_default" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_assignments_flag_user_idx" ON "experiment_assignments" ("flag_id","user_id");--> statement-breakpoint
CREATE INDEX "experiment_assignments_flag_idx" ON "experiment_assignments" ("flag_id");--> statement-breakpoint
CREATE INDEX "experiment_metrics_flag_metric_idx" ON "experiment_metrics" ("flag_id","metric_name");--> statement-breakpoint
CREATE INDEX "feature_flags_key_idx" ON "feature_flags" ("key");--> statement-breakpoint
CREATE INDEX "feature_flags_status_idx" ON "feature_flags" ("status");--> statement-breakpoint
CREATE INDEX "issues_app_id_idx" ON "issues" ("app_id");--> statement-breakpoint
CREATE INDEX "issues_status_idx" ON "issues" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_app_fingerprint_idx" ON "issues" ("app_id","fingerprint");--> statement-breakpoint
CREATE INDEX "projects_slug_idx" ON "projects" ("slug");--> statement-breakpoint
CREATE INDEX "releases_app_id_idx" ON "releases" ("app_id");--> statement-breakpoint
CREATE INDEX "releases_last_seen_idx" ON "releases" ("last_seen");--> statement-breakpoint
CREATE UNIQUE INDEX "releases_app_version_idx" ON "releases" ("app_id","version");--> statement-breakpoint
CREATE INDEX "segments_name_idx" ON "segments" ("name");--> statement-breakpoint
CREATE INDEX "source_map_tokens_project_id_idx" ON "source_map_tokens" ("project_id");--> statement-breakpoint
CREATE INDEX "source_map_tokens_app_id_idx" ON "source_map_tokens" ("app_id");--> statement-breakpoint
CREATE INDEX "source_map_tokens_environment_id_idx" ON "source_map_tokens" ("environment_id");--> statement-breakpoint
CREATE INDEX "source_map_tokens_hash_idx" ON "source_map_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX "source_maps_project_id_idx" ON "source_maps" ("project_id");--> statement-breakpoint
CREATE INDEX "source_maps_project_release_idx" ON "source_maps" ("project_id","release");--> statement-breakpoint
CREATE UNIQUE INDEX "source_maps_artifact_idx" ON "source_maps" ("project_id","release","filename");