CREATE TABLE "alert_channels" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" text DEFAULT '{}' NOT NULL,
	"app_id" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_incidents" (
	"id" text PRIMARY KEY,
	"rule_id" text NOT NULL,
	"app_id" text,
	"metric" text NOT NULL,
	"value" real NOT NULL,
	"threshold" real NOT NULL,
	"status" text DEFAULT 'firing' NOT NULL,
	"triggered_at" text NOT NULL,
	"resolved_at" text
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"metric" text NOT NULL,
	"operator" text NOT NULL,
	"threshold" real NOT NULL,
	"window_seconds" integer NOT NULL,
	"cooldown_seconds" integer DEFAULT 60 NOT NULL,
	"channel_ids" text DEFAULT '[]' NOT NULL,
	"measurement" text,
	"app_id" text,
	"is_enabled" integer DEFAULT 1 NOT NULL,
	"last_triggered_at" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"name" text NOT NULL,
	"platform" text DEFAULT 'javascript' NOT NULL,
	"ingest_key" text NOT NULL UNIQUE,
	"public_key" text NOT NULL,
	"host" text DEFAULT 'localhost' NOT NULL,
	"protocol" text DEFAULT 'https' NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dsn_records" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL UNIQUE,
	"public_key" text NOT NULL,
	"host" text DEFAULT 'localhost' NOT NULL,
	"protocol" text DEFAULT 'https' NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_default" integer DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiment_assignments" (
	"id" text PRIMARY KEY,
	"flag_id" text NOT NULL,
	"user_id" text NOT NULL,
	"variant_key" text NOT NULL,
	"context" text DEFAULT '{}' NOT NULL,
	"assigned_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiment_metrics" (
	"id" text PRIMARY KEY,
	"flag_id" text NOT NULL,
	"variant_key" text NOT NULL,
	"user_id" text NOT NULL,
	"metric_name" text NOT NULL,
	"value" real DEFAULT 1 NOT NULL,
	"recorded_at" text NOT NULL
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
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"description" text DEFAULT '',
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
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
	"first_seen" text,
	"last_seen" text,
	"event_count" integer DEFAULT 0 NOT NULL,
	"latest_event_id" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"description" text DEFAULT '',
	"rules" text DEFAULT '[]' NOT NULL,
	"user_count" integer DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
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
	"created_at" text NOT NULL,
	"last_used_at" text,
	"expires_at" text,
	"revoked_at" text
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
	"size" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stored_events" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"app_id" text,
	"envelope_header" text NOT NULL,
	"envelope_items" text NOT NULL,
	"raw" text NOT NULL,
	"received_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX "alert_channels_app_id_idx" ON "alert_channels" ("app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_channels_scope_name_idx" ON "alert_channels" ("app_id","name");--> statement-breakpoint
CREATE INDEX "alert_incidents_rule_id_idx" ON "alert_incidents" ("rule_id");--> statement-breakpoint
CREATE INDEX "alert_incidents_app_id_idx" ON "alert_incidents" ("app_id");--> statement-breakpoint
CREATE INDEX "alert_incidents_status_idx" ON "alert_incidents" ("status");--> statement-breakpoint
CREATE INDEX "alert_rules_app_id_idx" ON "alert_rules" ("app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_rules_scope_name_idx" ON "alert_rules" ("app_id","name");--> statement-breakpoint
CREATE INDEX "apps_project_id_idx" ON "apps" ("project_id");--> statement-breakpoint
CREATE INDEX "apps_ingest_key_idx" ON "apps" ("ingest_key");--> statement-breakpoint
CREATE INDEX "dsn_records_project_id_idx" ON "dsn_records" ("project_id");--> statement-breakpoint
CREATE INDEX "environments_project_id_idx" ON "environments" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_project_slug_idx" ON "environments" ("project_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_one_default_idx" ON "environments" ("project_id") WHERE "is_default" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_assignments_flag_user_idx" ON "experiment_assignments" ("flag_id","user_id");--> statement-breakpoint
CREATE INDEX "experiment_assignments_flag_idx" ON "experiment_assignments" ("flag_id");--> statement-breakpoint
CREATE INDEX "experiment_metrics_flag_metric_idx" ON "experiment_metrics" ("flag_id","metric_name");--> statement-breakpoint
CREATE INDEX "feature_flags_key_idx" ON "feature_flags" ("key");--> statement-breakpoint
CREATE INDEX "feature_flags_status_idx" ON "feature_flags" ("status");--> statement-breakpoint
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
CREATE UNIQUE INDEX "source_maps_artifact_idx" ON "source_maps" ("project_id","release","filename");--> statement-breakpoint
CREATE INDEX "stored_events_project_id_idx" ON "stored_events" ("project_id");--> statement-breakpoint
CREATE INDEX "stored_events_app_id_idx" ON "stored_events" ("app_id");--> statement-breakpoint
CREATE INDEX "stored_events_received_at_idx" ON "stored_events" ("received_at");