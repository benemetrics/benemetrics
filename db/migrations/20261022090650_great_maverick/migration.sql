ALTER TABLE "alert_channels" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD COLUMN "project_id" text;--> statement-breakpoint
DROP INDEX "alert_channels_global_name_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "alert_channels_global_name_idx" ON "alert_channels" ("name") WHERE "app_id" is null and "project_id" is null;--> statement-breakpoint
DROP INDEX "alert_rules_global_name_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "alert_rules_global_name_idx" ON "alert_rules" ("name") WHERE "app_id" is null and "project_id" is null;--> statement-breakpoint
CREATE INDEX "alert_channels_project_id_idx" ON "alert_channels" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_channels_project_name_idx" ON "alert_channels" ("project_id","name") WHERE "app_id" is null;--> statement-breakpoint
CREATE INDEX "alert_rules_project_id_idx" ON "alert_rules" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_rules_project_name_idx" ON "alert_rules" ("project_id","name") WHERE "app_id" is null;