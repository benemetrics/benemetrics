import {
  pgTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";

// app_id IS NULL marks a global (default)
// rule; an app-scoped rule with the same name replaces the
// global one.
export const alertRules = pgTable(
  "alert_rules",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    metric: text("metric").notNull(),
    operator: text("operator").notNull(),
    threshold: real("threshold").notNull(),
    windowSeconds: integer("window_seconds").notNull(),
    cooldownSeconds: integer("cooldown_seconds").notNull().default(60),
    channelIds: text("channel_ids").notNull().default("[]"),
    measurement: text("measurement"),
    appId: text("app_id"),
    isEnabled: integer("is_enabled").notNull().default(1),
    lastTriggeredAt: text("last_triggered_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    appIdIdx: index("alert_rules_app_id_idx").on(table.appId),
    scopeNameUnique: uniqueIndex("alert_rules_scope_name_idx").on(
      table.appId,
      table.name,
    ),
    globalNameUnique: uniqueIndex("alert_rules_global_name_idx")
      .on(table.name)
      .where(sql`${table.appId} is null`),
  }),
);

export type AlertRuleRow = typeof alertRules.$inferSelect;
export type AlertRuleInsert = typeof alertRules.$inferInsert;
