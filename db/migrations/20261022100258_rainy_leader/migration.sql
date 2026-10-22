ALTER TABLE "feature_flags" DROP CONSTRAINT "feature_flags_key_key";--> statement-breakpoint
ALTER TABLE "feature_flags" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD COLUMN "app_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_scope_key_idx" ON "feature_flags" (coalesce("project_id", ''),coalesce("app_id", ''),"key");