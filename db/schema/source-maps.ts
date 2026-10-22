import {
  pgTable,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { isoTimestamp } from "./timestamps";

// A source map artifact uploaded for a release. `filename` is the
// artifact name sentry-cli sends (the --url-prefix path, e.g.
// "~/dist/app.js.map"); `mapJson` is the raw map document.
export const sourceMaps = pgTable(
  "source_maps",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    appId: text("app_id").notNull(),
    environmentId: text("environment_id").notNull(),
    release: text("release").notNull(),
    dist: text("dist"),
    filename: text("filename").notNull(),
    mapJson: text("map_json").notNull(),
    createdAt: isoTimestamp("created_at").notNull(),
  },
  (table) => ({
    projectIdIdx: index("source_maps_project_id_idx").on(table.projectId),
    releaseIdx: index("source_maps_project_release_idx").on(
      table.projectId,
      table.release,
    ),
    artifactUnique: uniqueIndex("source_maps_artifact_idx").on(
      table.projectId,
      table.release,
      table.filename,
    ),
  }),
);

export type SourceMap = typeof sourceMaps.$inferSelect;
export type SourceMapInsert = typeof sourceMaps.$inferInsert;
