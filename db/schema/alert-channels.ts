import { pgTable, text, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";

export const alertChannels = pgTable(
  "alert_channels",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    config: text("config").notNull().default("{}"),
    appId: text("app_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    appIdIdx: index("alert_channels_app_id_idx").on(table.appId),
    appNameUnique: uniqueIndex("alert_channels_app_name_unique").on(table.appId, table.name),
    globalNameUnique: uniqueIndex("alert_channels_global_name_unique").on(table.name).where(sql`app_id IS NULL`),
  }),
);

export type AlertChannel = typeof alertChannels.$inferSelect;
export type AlertChannelInsert = typeof alertChannels.$inferInsert;