ALTER TABLE "feature_flags" DROP COLUMN "created_by";--> statement-breakpoint
ALTER TABLE "feature_flags" DROP COLUMN "updated_by";--> statement-breakpoint
ALTER TABLE "segments" DROP COLUMN "user_count";--> statement-breakpoint
ALTER TABLE "segments" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "source_maps" DROP COLUMN "size";