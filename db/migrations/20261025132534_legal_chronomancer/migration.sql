CREATE TABLE "alert_channels" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" text DEFAULT '{}' NOT NULL,
	"app_id" text,
	"project_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"correlation_key" text,
	"parent_id" text,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"assignee" text,
	CONSTRAINT "alert_incidents_trigger_check" CHECK ("trigger" in ('threshold', 'new_issue', 'regression')),
	CONSTRAINT "alert_incidents_status_check" CHECK ("status" in ('firing', 'resolved'))
);
--> statement-breakpoint
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
CREATE TABLE "alert_rules" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"trigger" text DEFAULT 'threshold' NOT NULL,
	"metric" text,
	"operator" text,
	"threshold" real,
	"threshold_factor" real,
	"folder" text,
	"window_seconds" integer,
	"cooldown_seconds" integer DEFAULT 3600 NOT NULL,
	"channel_ids" text DEFAULT '[]' NOT NULL,
	"measurement" text,
	"app_id" text,
	"project_id" text,
	"filters" text DEFAULT '{}' NOT NULL,
	"message" text,
	"is_enabled" integer DEFAULT 1 NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_rules_trigger_check" CHECK ("trigger" in ('threshold', 'new_issue', 'regression'))
);
--> statement-breakpoint
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
CREATE TABLE "apps" (
	"id" text PRIMARY KEY,
	"number" serial UNIQUE,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"platform" text DEFAULT 'javascript' NOT NULL,
	"ingest_key" text NOT NULL UNIQUE,
	"public_key" text NOT NULL,
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
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '',
	"type" text NOT NULL,
	"default_value" text NOT NULL,
	"variants" text DEFAULT '[]' NOT NULL,
	"targeting_rules" text DEFAULT '[]' NOT NULL,
	"segments" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"project_id" text,
	"app_id" text,
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
	"tags" text DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'unresolved' NOT NULL,
	"event_count" integer DEFAULT 1 NOT NULL,
	"user_count" integer DEFAULT 0 NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"latest_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "permission_grants" (
	"id" text PRIMARY KEY,
	"identity_id" text NOT NULL,
	"label" text,
	"project_ids" text DEFAULT '[]' NOT NULL,
	"app_prefixes" text DEFAULT '[]' NOT NULL,
	"is_enabled" integer DEFAULT 1 NOT NULL,
	"can_write" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission_rules" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"project_ids" text DEFAULT '[]' NOT NULL,
	"app_prefixes" text DEFAULT '[]' NOT NULL,
	"is_enabled" integer DEFAULT 1 NOT NULL,
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
	"release" text NOT NULL,
	"dist" text,
	"filename" text NOT NULL,
	"map_json" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "alert_channels_app_id_idx" ON "alert_channels" ("app_id");--> statement-breakpoint
CREATE INDEX "alert_channels_project_id_idx" ON "alert_channels" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_channels_scope_name_idx" ON "alert_channels" ("app_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_channels_project_name_idx" ON "alert_channels" ("project_id","name") WHERE "app_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_channels_global_name_idx" ON "alert_channels" ("name") WHERE "app_id" is null and "project_id" is null;--> statement-breakpoint
CREATE INDEX "alert_dead_letters_next_attempt_at_idx" ON "alert_dead_letters" ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "alert_incidents_rule_id_idx" ON "alert_incidents" ("rule_id");--> statement-breakpoint
CREATE INDEX "alert_incidents_app_id_idx" ON "alert_incidents" ("app_id");--> statement-breakpoint
CREATE INDEX "alert_incidents_status_idx" ON "alert_incidents" ("status");--> statement-breakpoint
CREATE INDEX "alert_rule_history_rule_id_idx" ON "alert_rule_history" ("rule_id");--> statement-breakpoint
CREATE INDEX "alert_rules_app_id_idx" ON "alert_rules" ("app_id");--> statement-breakpoint
CREATE INDEX "alert_rules_project_id_idx" ON "alert_rules" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_rules_scope_name_idx" ON "alert_rules" ("app_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_rules_project_name_idx" ON "alert_rules" ("project_id","name") WHERE "app_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_rules_global_name_idx" ON "alert_rules" ("name") WHERE "app_id" is null and "project_id" is null;--> statement-breakpoint
CREATE INDEX "alert_silences_scope_idx" ON "alert_silences" ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "apps_project_id_idx" ON "apps" ("project_id");--> statement-breakpoint
CREATE INDEX "apps_ingest_key_idx" ON "apps" ("ingest_key");--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_assignments_flag_user_idx" ON "experiment_assignments" ("flag_id","user_id");--> statement-breakpoint
CREATE INDEX "experiment_assignments_flag_idx" ON "experiment_assignments" ("flag_id");--> statement-breakpoint
CREATE INDEX "experiment_metrics_flag_metric_idx" ON "experiment_metrics" ("flag_id","metric_name");--> statement-breakpoint
CREATE INDEX "feature_flags_key_idx" ON "feature_flags" ("key");--> statement-breakpoint
CREATE INDEX "feature_flags_status_idx" ON "feature_flags" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_scope_key_idx" ON "feature_flags" (coalesce("project_id", ''),coalesce("app_id", ''),"key");--> statement-breakpoint
CREATE INDEX "issues_app_id_idx" ON "issues" ("app_id");--> statement-breakpoint
CREATE INDEX "issues_status_idx" ON "issues" ("status");--> statement-breakpoint
CREATE INDEX "issues_status_last_seen_id_idx" ON "issues" ("status","last_seen","id");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_app_fingerprint_idx" ON "issues" ("app_id","fingerprint");--> statement-breakpoint
CREATE INDEX "permission_audit_target_idx" ON "permission_audit" ("target","target_id");--> statement-breakpoint
CREATE INDEX "permission_audit_created_at_idx" ON "permission_audit" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_grants_identity_id_idx" ON "permission_grants" ("identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_rules_name_idx" ON "permission_rules" ("name");--> statement-breakpoint
CREATE INDEX "projects_slug_idx" ON "projects" ("slug");--> statement-breakpoint
CREATE INDEX "releases_app_id_idx" ON "releases" ("app_id");--> statement-breakpoint
CREATE INDEX "releases_last_seen_idx" ON "releases" ("last_seen");--> statement-breakpoint
CREATE UNIQUE INDEX "releases_app_version_idx" ON "releases" ("app_id","version");--> statement-breakpoint
CREATE INDEX "segments_name_idx" ON "segments" ("name");--> statement-breakpoint
CREATE INDEX "source_map_tokens_project_id_idx" ON "source_map_tokens" ("project_id");--> statement-breakpoint
CREATE INDEX "source_map_tokens_app_id_idx" ON "source_map_tokens" ("app_id");--> statement-breakpoint
CREATE INDEX "source_map_tokens_hash_idx" ON "source_map_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX "source_maps_project_id_idx" ON "source_maps" ("project_id");--> statement-breakpoint
CREATE INDEX "source_maps_project_release_idx" ON "source_maps" ("project_id","release");--> statement-breakpoint
CREATE UNIQUE INDEX "source_maps_artifact_idx" ON "source_maps" ("project_id","release","filename");