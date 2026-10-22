import {
  pgTable,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { isoTimestamp } from "./timestamps";

// The scope: app_id set = the app scope; project_id set (and app_id
// null) = the project scope; both null = the global scope. A narrower
// channel with the same name replaces the wider one.
export const alertChannels = pgTable(
  "alert_channels",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    config: text("config").notNull().default("{}"),
    appId: text("app_id"),
    projectId: text("project_id"),
    createdAt: isoTimestamp("created_at").notNull().default(sql`now()`),
    updatedAt: isoTimestamp("updated_at").notNull().default(sql`now()`),
  },
  (table) => ({
    appIdIdx: index("alert_channels_app_id_idx").on(table.appId),
    projectIdIdx: index("alert_channels_project_id_idx").on(table.projectId),
    scopeNameUnique: uniqueIndex("alert_channels_scope_name_idx").on(
      table.appId,
      table.name,
    ),
    projectNameUnique: uniqueIndex("alert_channels_project_name_idx")
      .on(table.projectId, table.name)
      .where(sql`${table.appId} is null`),
    globalNameUnique: uniqueIndex("alert_channels_global_name_idx")
      .on(table.name)
      .where(sql`${table.appId} is null and ${table.projectId} is null`),
  }),
);

export type AlertChannelRow = typeof alertChannels.$inferSelect;
export type AlertChannelInsert = typeof alertChannels.$inferInsert;
