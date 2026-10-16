import {
  pgTable,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";

// app_id IS NULL marks a
// global (default) channel; an app-scoped channel with the
// same name replaces the global one.
export const alertChannels = pgTable(
  "alert_channels",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    config: text("config").notNull().default("{}"),
    appId: text("app_id"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    appIdIdx: index("alert_channels_app_id_idx").on(table.appId),
    scopeNameUnique: uniqueIndex("alert_channels_scope_name_idx").on(
      table.appId,
      table.name,
    ),
    globalNameUnique: uniqueIndex("alert_channels_global_name_idx")
      .on(table.name)
      .where(sql`${table.appId} is null`),
  }),
);

export type AlertChannelRow = typeof alertChannels.$inferSelect;
export type AlertChannelInsert = typeof alertChannels.$inferInsert;
