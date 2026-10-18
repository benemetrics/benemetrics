import { pgTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/pg-core";

export const alertRules = pgTable(
  "alert_rules",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    trigger: text("trigger").notNull().default("threshold"),
    metric: text("metric"),
    operator: text("operator"),
    threshold: real("threshold"),
    windowSeconds: integer("window_seconds"),
    cooldownSeconds: integer("cooldown_seconds").notNull().default(3600),
    channelIds: text("channel_ids").notNull().default("[]"),
    measurement: text("measurement"),
    appId: text("app_id"),
    isEnabled: integer("is_enabled").notNull().default(1),
    lastTriggeredAt: text("last_triggered_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    appIdIdx: index("alert_rules_app_id_idx").on(table.appId),
    appNameUnique: uniqueIndex("alert_rules_app_name_unique").on(table.appId, table.name),
    globalNameUnique: uniqueIndex("alert_rules_global_name_unique").on(table.name).where(table.appId.isNull()),
  }),
);

export type AlertRule = typeof alertRules.$inferSelect;
export type AlertRuleInsert = typeof alertRules.$inferInsert;