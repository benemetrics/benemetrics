import { pgTable, text, index, uuid } from "drizzle-orm/pg-core";
import { isoTimestamp } from "./timestamps";
import { sql } from "drizzle-orm/sql";
import { apps } from "./app";

export const sourceMaps = pgTable(
  "source_maps",
  {
    id: uuid("id")
      .default(sql`uuidv7()`)
      .primaryKey(),
    appId: text("app_id")
      .references(() => apps.id)
      .notNull(),
    release: text("release").notNull(),
    dist: text("dist"),
    filename: text("filename").notNull(),
    mapJson: text("map_json").notNull(),
    createdAt: isoTimestamp("created_at")
      .default(sql`now()`)
      .notNull(),
    updatedAt: isoTimestamp("updated_at")
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => sql`now()`),
  },
  (table) => [index().on(table.appId)],
);

export const artifactPublicFields = {
  id: sourceMaps.id,
  appId: sourceMaps.appId,
  release: sourceMaps.release,
  dist: sourceMaps.dist,
  name: sourceMaps.filename,
  size: sql<number>`octet_length(${sourceMaps.mapJson})`,
  createdAt: sourceMaps.createdAt,
  updatedAt: sourceMaps.updatedAt,
};

export type SourceMap = typeof sourceMaps.$inferSelect;
export type SourceMapInsert = typeof sourceMaps.$inferInsert;
