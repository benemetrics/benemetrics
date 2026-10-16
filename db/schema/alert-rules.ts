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
//
// `trigger` selects what fires the rule:
//   - "threshold": the metric/operator/threshold/window fields define a
//     windowed metric breach (evaluated by the sweeper).
//   - "new_issue" / "regression": fired from ingestion when an issue
//     appears for the first time / reopens after being resolved; the
//     threshold fields are null.
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
