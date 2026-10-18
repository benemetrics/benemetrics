import { pgTable, text, real, index } from "drizzle-orm/pg-core";

export const alertIncidents = pgTable(
  "alert_incidents",
  {
    id: text("id").primaryKey(),
    ruleId: text("rule_id").notNull(),
    appId: text("app_id"),
    trigger: text("trigger").notNull().default("threshold"),
    issueFingerprint: text("issue_fingerprint"),
    metric: text("metric"),
    value: real("value"),
    threshold: real("threshold"),
    status: text("status").notNull().default("firing"),
    triggeredAt: text("triggered_at").notNull(),
    resolvedAt: text("resolved_at"),
  },
  (table) => ({
    ruleIdIdx: index("alert_incidents_rule_id_idx").on(table.ruleId),
    appIdIdx: index("alert_incidents_app_id_idx").on(table.appId),
    statusIdx: index("alert_incidents_status_idx").on(table.status),
  }),
);

export type AlertIncident = typeof alertIncidents.$inferSelect;
export type AlertIncidentInsert = typeof alertIncidents.$inferInsert;