import {
  pgTable,
  text,
  integer,
  real,
  check,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { isoTimestamp } from "./timestamps";

// The scope: app_id set = the app scope; project_id set (and app_id
// null) = the project scope; both null = the global scope. A narrower rule
// with the same name replaces the wider one.
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
    cooldownSeconds: integer("cooldown_seconds").notNull().default(3600),
    channelIds: text("channel_ids").notNull().default("[]"),
    measurement: text("measurement"),
    appId: text("app_id"),
    projectId: text("project_id"),
    // The dimensions the rule matches on (the tags); a JSON object.
    filters: text("filters").notNull().default("{}"),
    isEnabled: integer("is_enabled").notNull().default(1),
    lastTriggeredAt: isoTimestamp("last_triggered_at"),
    createdAt: isoTimestamp("created_at").notNull().default(sql`now()`),
    updatedAt: isoTimestamp("updated_at").notNull().default(sql`now()`),
  },
  (table) => ({
    appIdIdx: index("alert_rules_app_id_idx").on(table.appId),
    projectIdIdx: index("alert_rules_project_id_idx").on(table.projectId),
    scopeNameUnique: uniqueIndex("alert_rules_scope_name_idx").on(
      table.appId,
      table.name,
    ),
    projectNameUnique: uniqueIndex("alert_rules_project_name_idx")
      .on(table.projectId, table.name)
      .where(sql`${table.appId} is null`),
    globalNameUnique: uniqueIndex("alert_rules_global_name_idx")
      .on(table.name)
      .where(sql`${table.appId} is null and ${table.projectId} is null`),
    triggerCheck: check(
      "alert_rules_trigger_check",
      sql`${table.trigger} in ('threshold', 'new_issue', 'regression')`,
    ),
  }),
);

export type AlertRuleRow = typeof alertRules.$inferSelect;
export type AlertRuleInsert = typeof alertRules.$inferInsert;
